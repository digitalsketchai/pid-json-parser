const fs = require("fs");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");
require("dotenv").config();

const SAMPLE_DIR = path.join(__dirname, "sample");
const OUTPUT_DIR = path.join(__dirname, "info");
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".bmp"]);
const PDF_EXT = new Set([".pdf"]);
const SUPPORTED_EXT = new Set([...IMAGE_EXT, ...PDF_EXT]);

function getConfig() {
    return {
        pipeline_status_poll_interval: parseInt(process.env.PIPELINE_STATUS_POLL_INTERVAL_SECONDS || "40", 10),
        run_id_poll_interval: parseInt(process.env.RUN_ID_POLL_INTERVAL_SECONDS || "15", 10),
        pipeline_status_timeout: parseInt(process.env.PIPELINE_STATUS_TIMEOUT_SECONDS || "7200", 10),
        run_id_timeout: parseInt(process.env.RUN_ID_TIMEOUT_SECONDS || "600", 10),
        pdf_poll_interval: parseInt(process.env.PDF_POLL_INTERVAL_SECONDS || "2", 10),
        pdf_timeout: parseInt(process.env.PDF_TIMEOUT_SECONDS || "900", 10),
    };
}

const CONFIG = getConfig();
const PIPELINE_STATUS_POLL_INTERVAL_SECONDS = CONFIG.pipeline_status_poll_interval;
const PIPELINE_STATUS_TIMEOUT_SECONDS = CONFIG.pipeline_status_timeout;
const RUN_ID_POLL_INTERVAL_SECONDS = CONFIG.run_id_poll_interval;
const RUN_ID_TIMEOUT_SECONDS = CONFIG.run_id_timeout;
const PDF_POLL_INTERVAL_SECONDS = CONFIG.pdf_poll_interval;
const PDF_TIMEOUT_SECONDS = CONFIG.pdf_timeout;

const STATUS_TEXT = {
    "-1": "queued",
    "0": "running",
    "1": "complete",
    "2": "error",
    "3": "stopped",
    "4": "timeout",
    "5": "unknown",
};

const MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".bmp": "image/bmp",
    ".pdf": "application/pdf",
};

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function guessMimeType(filename) {
    return MIME_BY_EXT[path.extname(filename).toLowerCase()] || null;
}

function pickSampleFile(filename) {
    if (!fs.existsSync(SAMPLE_DIR)) {
        throw new Error(`Sample directory not found: ${SAMPLE_DIR}`);
    }

    if (filename) {
        const filepath = path.join(SAMPLE_DIR, filename);
        if (fs.existsSync(filepath) && fs.statSync(filepath).isFile()) {
            return filepath;
        }
        throw new Error(`File not found: ${filepath}`);
    }

    const files = fs.readdirSync(SAMPLE_DIR)
        .sort()
        .map((name) => path.join(SAMPLE_DIR, name))
        .filter((p) => fs.statSync(p).isFile() && SUPPORTED_EXT.has(path.extname(p).toLowerCase()));

    if (files.length === 0) {
        throw new Error(
            `No supported P&ID file found in ${SAMPLE_DIR}. ` +
            `Supported extensions: ${[...SUPPORTED_EXT].sort()}`
        );
    }
    return files[0];
}

function encodeBase64(filepath) {
    return fs.readFileSync(filepath).toString("base64");
}

async function uploadImage(baseUrl, apiKey, imagePath) {
    const url = `${baseUrl}/digitalsketch/uploadimage`;
    console.log(`  POST ${url}`);
    const mimeType = guessMimeType(path.basename(imagePath));
    const body = {
        api_key: apiKey,
        base64_image: encodeBase64(imagePath),
    };
    if (mimeType) {
        body.mime_type = mimeType;
    }
    const resp = await axios.post(url, body, { timeout: 180000 });
    const payload = resp.data;
    if (!payload.success || !payload.imageid) {
        throw new Error(`Image upload failed: ${JSON.stringify(payload)}`);
    }
    return payload.imageid;
}

async function uploadPdf(baseUrl, apiKey, pdfPath) {
    const url = `${baseUrl}/digitalsketch/uploadpdf/multipart`;
    console.log(`  POST ${url}`);
    const form = new FormData();
    form.append("api_key", apiKey);
    form.append("pdf_file", fs.createReadStream(pdfPath), {
        filename: path.basename(pdfPath),
        contentType: "application/pdf",
    });
    const resp = await axios.post(url, form, {
        headers: form.getHeaders(),
        timeout: 300000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });
    const payload = resp.data;
    const pdfid = payload.pdfid;
    if (!payload.success || !pdfid) {
        throw new Error(`PDF upload failed: ${JSON.stringify(payload)}`);
    }
    return pdfid;
}

async function waitForPdf(baseUrl, apiKey, pdfid) {
    const url = `${baseUrl}/digitalsketch/uploadpdfstatus`;
    const deadline = Date.now() + PDF_TIMEOUT_SECONDS * 1000;
    let lastPayload = {};
    let checkCount = 0;
    while (Date.now() < deadline) {
        checkCount += 1;
        console.log(`  POST ${url} (Check #${checkCount})`);
        const resp = await axios.post(url, { api_key: apiKey, pdfid }, { timeout: 60000 });
        lastPayload = resp.data;
        const status = lastPayload.status;
        const statusText = lastPayload.status_text || STATUS_TEXT[String(status)] || "unknown";
        const pagecount = lastPayload.pagecount;
        const imageids = lastPayload.imageids || [];
        console.log(`    status: ${statusText}, pages: ${pagecount}, imageids: ${imageids.length}`);
        if (status === 1) {
            if (imageids.length === 0) {
                throw new Error(`PDF processed but no imageids returned: ${JSON.stringify(lastPayload)}`);
            }
            console.log(`  Multi-Page PDF Detected: Found ${imageids.length} pages`);
            return imageids;
        }
        if ([2, 3, 4].includes(status)) {
            throw new Error(`PDF processing ended with status ${statusText}: ${JSON.stringify(lastPayload)}`);
        }
        await sleep(PDF_POLL_INTERVAL_SECONDS * 1000);
    }
    throw new Error(`PDF processing did not complete within ${PDF_TIMEOUT_SECONDS}s. Last: ${JSON.stringify(lastPayload)}`);
}


async function getImageDetails(baseUrl, apiKey, imageid) {
    const url = `${baseUrl}/digitalsketch/${imageid}/imagedetails`;
    console.log(`  POST ${url}`);
    const resp = await axios.post(url, { api_key: apiKey }, { timeout: 60000 });
    return resp.data;
}

async function startPipeline(baseUrl, apiKey, imageid) {
    const url = `${baseUrl}/digitalsketch/pipeline/start`;
    console.log(`  POST ${url}`);
    const resp = await axios.post(url, { api_key: apiKey, imageid }, { timeout: 60000 });
    return resp.data;
}

async function resolveRunId(baseUrl, apiKey, imageid, startPayload) {
    let runId = startPayload.run_id || startPayload.runid;
    if (runId) {
        return runId;
    }

    const url = `${baseUrl}/digitalsketch/pipeline/id`;
    const deadline = Date.now() + RUN_ID_TIMEOUT_SECONDS * 1000;
    let lastPayload = {};
    let checkCount = 0;

    while (Date.now() < deadline) {
        let remaining = deadline - Date.now();
        if (remaining <= 0) break;

        checkCount += 1;
        console.log(`  5.5. GET ${url} (Check #${checkCount})`);

        try {
            const resp = await axios.post(url, { api_key: apiKey, imageid }, { timeout: 60000 });
            lastPayload = resp.data;

            if (!lastPayload.success) {
                console.log(`    error: ${lastPayload.message || "Unknown error"}`);
            } else {
                runId = lastPayload.run_id || lastPayload.runid;
                if (runId) {
                    return runId;
                }
                console.log(`    status: ${lastPayload.status}, run_id not yet assigned`);
            }
        } catch (e) {
            console.log(`    request error: ${e.message}`);
        }

        remaining = deadline - Date.now();
        if (remaining > 0) {
            const countdownMs = Math.min(RUN_ID_POLL_INTERVAL_SECONDS * 1000, remaining);
            const countdownSec = Math.floor(countdownMs / 1000);
            for (let sec = countdownSec; sec > 0; sec--) {
                process.stdout.write(`    waiting ${sec}s...\r`);
                await sleep(1000);
            }
            process.stdout.write("                  \r");
        }
    }

    throw new Error(
        `run_id not assigned within ${RUN_ID_TIMEOUT_SECONDS}s for image ${imageid}. Last: ${JSON.stringify(lastPayload)}`
    );
}

async function waitForPipeline(baseUrl, apiKey, runId) {
    const url = `${baseUrl}/digitalsketch/pipeline/status`;
    const deadline = Date.now() + PIPELINE_STATUS_TIMEOUT_SECONDS * 1000;
    let lastPayload = {};
    let checkCount = 0;

    while (Date.now() < deadline) {
        let remaining = deadline - Date.now();
        if (remaining <= 0) break;

        checkCount += 1;
        console.log(`  POST ${url} (Check #${checkCount})`);

        try {
            const resp = await axios.post(url, { api_key: apiKey, run_id: runId }, { timeout: 60000 });
            lastPayload = resp.data;

            if (!lastPayload.success) {
                console.log(`    error: ${lastPayload.message || "Unknown error"}`);
                await sleep(PIPELINE_STATUS_POLL_INTERVAL_SECONDS * 1000);
                continue;
            }

            const status = lastPayload.status;
            const statusText = lastPayload.status_text || STATUS_TEXT[String(status)] || "unknown";
            const completion = lastPayload.completion;
            const progress = completion ? ` (${completion})` : "";
            console.log(`    status: ${statusText}${progress}`);

            if (status === 1) {
                console.log("    pipeline complete!");
                return lastPayload;
            }

            if ([2, 3, 4].includes(status)) {
                const errorMsg = lastPayload.message || lastPayload.error || "Unknown error";
                console.log(`    error message: ${errorMsg}`);
                throw new Error(
                    `Pipeline ended with status ${statusText}. Error: ${errorMsg}. Full response: ${JSON.stringify(lastPayload)}`
                );
            }
        } catch (e) {
            if (e.isAxiosError) {
                console.log(`    request error: ${e.message}`);
            } else {
                throw e;
            }
        }

        remaining = deadline - Date.now();
        if (remaining > 0) {
            const countdownMs = Math.min(PIPELINE_STATUS_POLL_INTERVAL_SECONDS * 1000, remaining);
            const countdownSec = Math.floor(countdownMs / 1000);
            for (let sec = countdownSec; sec > 0; sec--) {
                process.stdout.write(`    waiting ${sec}s...\r`);
                await sleep(1000);
            }
            process.stdout.write("                  \r");
        }
    }

    throw new Error(
        `Pipeline did not complete within ${PIPELINE_STATUS_TIMEOUT_SECONDS}s. Last: ${JSON.stringify(lastPayload)}`
    );
}

async function getAllInfo(baseUrl, apiKey, imageid) {
    const url = `${baseUrl}/digitalsketch/diagram/info/all`;
    console.log(`  GET ${url}`);
    const resp = await axios.get(url, {
        params: { api_key: apiKey, imageid },
        timeout: 120000,
    });
    return resp.data;
}


async function processImage(baseUrl, apiKey, imageid, pageNum, totalPages) {
    const label = `[Page ${pageNum}/${totalPages}]`;
    console.log(`${label} 4. GET /digitalsketch/{imageid}/imagedetails`);
    const details = await getImageDetails(baseUrl, apiKey, imageid);
    const imageSize = details.imagesize;
    console.log(`  image_name=${details.image_name} ext=${details.extension} size=${imageSize}`);

    if (imageSize && imageSize < 100) {
        console.log(`  WARNING: Image size is only ${imageSize} bytes - image may be corrupted!`);
        console.log(`  Returning empty info for this page.`);
        return {
            success: false,
            imageid,
            info: [],
            count: 0,
            error: `Image size too small (${imageSize} bytes), likely corrupted from PDF extraction`,
            timestamp: "",
        };
    }

    console.log(`${label} 5. POST /digitalsketch/pipeline/start`);
    const startPayload = await startPipeline(baseUrl, apiKey, imageid);
    const runId = await resolveRunId(baseUrl, apiKey, imageid, startPayload);
    console.log(`  run_id: ${runId}`);

    console.log(`${label} 6. POST /digitalsketch/pipeline/status`);
    await waitForPipeline(baseUrl, apiKey, runId);

    console.log(`${label} 7. GET /digitalsketch/diagram/info/all`);
    return getAllInfo(baseUrl, apiKey, imageid);
}

async function main() {
    const apiKey = process.env.DIGITALSKETCH_API_KEY;
    const baseUrl = (process.env.DIGITALSKETCH_API_BASE || "https://api.digitalsketch.ai").replace(/\/+$/, "");
    if (!apiKey) {
        console.error("ERROR: DIGITALSKETCH_API_KEY is not set. Add it to a .env file.");
        return 1;
    }

    console.log(
        `Config: PIPELINE_STATUS_POLL_INTERVAL=${PIPELINE_STATUS_POLL_INTERVAL_SECONDS}s ` +
        `(timeout ${PIPELINE_STATUS_TIMEOUT_SECONDS}s), ` +
        `RUN_ID_POLL_INTERVAL=${RUN_ID_POLL_INTERVAL_SECONDS}s ` +
        `(timeout ${RUN_ID_TIMEOUT_SECONDS}s)`
    );
    console.log();

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const filename = process.argv[2] || null;
    const samplePath = pickSampleFile(filename);
    const ext = path.extname(samplePath).toLowerCase();
    const stem = path.basename(samplePath, path.extname(samplePath));
    console.log(`Using sample file: ${path.basename(samplePath)}`);

    let imageids;
    if (PDF_EXT.has(ext)) {
        console.log("2. POST /digitalsketch/uploadpdf/multipart");
        const pdfid = await uploadPdf(baseUrl, apiKey, samplePath);
        console.log(`  pdfid: ${pdfid}`);
        console.log("3. POST /digitalsketch/uploadpdfstatus");
        imageids = await waitForPdf(baseUrl, apiKey, pdfid);
    } else {
        console.log("1. POST /digitalsketch/uploadimage");
        const imageid = await uploadImage(baseUrl, apiKey, samplePath);
        console.log(`  imageid: ${imageid}`);
        imageids = [imageid];
    }

    console.log();
    const totalPages = imageids.length;
    const isPdf = PDF_EXT.has(ext);
    console.log(`Processing ${totalPages} page(s):`);
    console.log();

    for (let idx = 0; idx < imageids.length; idx++) {
        const imageid = imageids[idx];
        const pageNum = idx + 1;
        console.log("=".repeat(70));
        console.log(`Processing Page ${pageNum} of ${totalPages}`);
        console.log("=".repeat(70));

        const info = await processImage(baseUrl, apiKey, imageid, pageNum, totalPages);

        const outName = isPdf
            ? `${stem}_page${pageNum}_${imageid}_info.json`
            : `${stem}_${imageid}_info.json`;
        const outPath = path.join(OUTPUT_DIR, outName);
        fs.writeFileSync(outPath, JSON.stringify(info, null, 2), { encoding: "utf-8" });
        console.log(`Saved to: ${outPath}`);
        console.log();
    }

    console.log("=".repeat(70));
    console.log(`Completed processing all ${totalPages} page(s)`);
    console.log("=".repeat(70));
    return 0;
}

main()
    .then((code) => process.exit(code || 0))
    .catch((err) => {
        console.error(err && err.stack ? err.stack : err);
        process.exit(1);
    });
