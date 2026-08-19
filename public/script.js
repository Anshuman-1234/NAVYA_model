document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();

    // ── Views ──
    const scanView   = document.getElementById('scan-view');
    const reportView = document.getElementById('report-view');

    // ── Scan Elements ──
    const video            = document.getElementById('camera-feed');
    const canvas           = document.getElementById('snapshot-canvas');
    const startBtn         = document.getElementById('start-btn');
    const batchKeyInput    = document.getElementById('batch-key');
    const errorMsg         = document.getElementById('error-msg');
    const controlsArea     = document.getElementById('controls-area');
    const countdownOverlay = document.getElementById('countdown-overlay');
    const countdownText    = document.getElementById('countdown-text');
    const loadingOverlay   = document.getElementById('loading-overlay');

    // ── Report Elements ──
    const capturedImg      = document.getElementById('captured-img');
    const imgBatchLabel    = document.getElementById('img-batch-label');
    const imgTimestamp     = document.getElementById('img-timestamp');
    const statusBanner     = document.getElementById('status-banner');
    const statusIcon       = document.getElementById('status-icon');
    const gradeText        = document.getElementById('grade-text');
    const confidenceVal    = document.getElementById('confidence-val');
    const freshnessScoreEl = document.getElementById('freshness-score');
    const spoilageIndexEl  = document.getElementById('spoilage-index');
    const shelfLifeEl      = document.getElementById('shelf-life');
    const shelfBar         = document.getElementById('shelf-bar');
    const telTempEl        = document.getElementById('tel-temp');
    const telHumEl         = document.getElementById('tel-hum');
    const telGasEl         = document.getElementById('tel-gas');
    const recTextEl        = document.getElementById('rec-text');

    // Print elements
    const printBatch = document.getElementById('print-batch');
    const printTime  = document.getElementById('print-time');

    let stream = null;
    let isProcessing = false;
    let snapshotDataUrl = '';

    // ── Camera ──
    async function startCamera() {
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } }
            });
            video.srcObject = stream;
        } catch (err) {
            showError('Unable to access camera. Please allow camera permission or use HTTPS.');
        }
    }

    function stopCamera() {
        if (stream) stream.getTracks().forEach(t => t.stop());
    }

    // ── Error Banner ──
    function showError(msg) {
        errorMsg.textContent = msg;
        errorMsg.classList.remove('hidden');
        setTimeout(() => errorMsg.classList.add('hidden'), 6000);
    }

    // ── Switch views ──
    function showReport() {
        scanView.classList.remove('active');
        scanView.classList.add('hidden');
        reportView.classList.remove('hidden');
        reportView.classList.add('active');
        lucide.createIcons();
        // Scroll to top
        reportView.querySelector('.report-scroll').scrollTop = 0;
    }

    function showScan() {
        reportView.classList.remove('active');
        reportView.classList.add('hidden');
        scanView.classList.remove('hidden');
        scanView.classList.add('active');
    }

    // ── Start Scan Button ──
    startBtn.addEventListener('click', () => {
        if (!batchKeyInput.value.trim()) {
            showError('Please enter a Batch ID first.');
            return;
        }
        if (isProcessing) return;
        isProcessing = true;
        startBtn.disabled = true;

        controlsArea.classList.add('hidden');
        countdownOverlay.classList.remove('hidden');

        let count = 3;
        countdownText.textContent = count;

        const timer = setInterval(() => {
            count -= 1;
            if (count > 0) {
                countdownText.textContent = count;
            } else {
                clearInterval(timer);
                countdownOverlay.classList.add('hidden');
                captureAndAnalyze();
            }
        }, 1000);
    });

    // ── Capture + Analyze ──
    async function captureAndAnalyze() {
        // Snapshot
        canvas.width  = video.videoWidth  || 640;
        canvas.height = video.videoHeight || 480;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        snapshotDataUrl = canvas.toDataURL('image/jpeg', 0.85);

        // Show loading
        video.classList.add('dimmed');
        loadingOverlay.classList.remove('hidden');

        try {
            // Visual feature extraction (simple pixel analysis)
            const ctx = canvas.getContext('2d');
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let redPx = 0, greenPx = 0, darkPx = 0, total = imgData.length / 4;

            for (let i = 0; i < imgData.length; i += 4) {
                const r = imgData[i], g = imgData[i+1], b = imgData[i+2];
                const brightness = (r + g + b) / 3;
                if (r > g + 30 && r > b + 30)  redPx++;
                if (g > r + 20 && g > b + 10)  greenPx++;
                if (brightness < 60)            darkPx++;
            }

            const payload = {
                batchKey:        batchKeyInput.value.trim(),
                greenRatio:      parseFloat((greenPx / total).toFixed(4)),
                redRatio:        parseFloat((redPx   / total).toFixed(4)),
                darkSpotRatio:   parseFloat((darkPx  / total).toFixed(4)),
                moldRatio:       0.00,
                textureRoughness: 110.0
            };

            // API URL
            const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            const apiUrl  = isLocal ? 'http://127.0.0.1:5000/predict' : '/api/predict';

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json().catch(() => ({
                success: false,
                error: 'SYSTEM FAIL: Invalid response from server.'
            }));

            loadingOverlay.classList.add('hidden');
            video.classList.remove('dimmed');

            if (response.ok && data.success) {
                populateReport(data, batchKeyInput.value.trim());
                showReport();
            } else {
                const errText = data.error || 'SYSTEM FAIL: Sensor or API unreachable.';
                showError(errText);
                resetScanner();
            }

        } catch (err) {
            console.error(err);
            loadingOverlay.classList.add('hidden');
            video.classList.remove('dimmed');
            showError('SYSTEM FAIL: Unable to connect to backend server / sensor API.');
            resetScanner();
        }
    }

    // ── Populate Report ──
    function populateReport(data, batchKey) {
        const isFresh     = data.grade && data.grade.toLowerCase().includes('fresh');
        const now         = new Date();
        const timeStr     = now.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
        const shelfDays   = parseInt(data.shelfLifeDays) || 0;
        const maxShelf    = 14;

        // Captured image
        capturedImg.src   = snapshotDataUrl;
        imgBatchLabel.textContent = `Batch: ${batchKey}`;
        imgTimestamp.textContent  = timeStr;

        // Status banner
        gradeText.textContent     = data.grade || (isFresh ? 'Fresh' : 'Rotten');
        confidenceVal.textContent = data.confidence ? Math.round(data.confidence * 100) : '--';
        statusBanner.className    = 'status-banner' + (isFresh ? '' : ' spoiled');
        statusIcon.setAttribute('data-lucide', isFresh ? 'check-circle' : 'alert-triangle');
        statusIcon.style.color    = isFresh ? '#16A34A' : '#EF4444';

        // Metrics
        const freshScore = Math.round(data.freshnessScore || (isFresh ? 80 : 20));
        freshnessScoreEl.textContent = freshScore;
        freshnessScoreEl.className   = 'metric-value ' + (isFresh ? 'fresh' : '');
        freshnessScoreEl.style.color = isFresh ? '' : '#EF4444';

        spoilageIndexEl.textContent  = Math.round(data.spoilageIndex || (isFresh ? 20 : 80));
        shelfLifeEl.textContent      = shelfDays;

        // Shelf life bar
        shelfBar.style.width = Math.min((shelfDays / maxShelf) * 100, 100) + '%';

        // Telemetry
        const tel = data.telemetry || {};
        telTempEl.textContent = tel.temperature != null ? tel.temperature : '--';
        telHumEl.textContent  = tel.humidity    != null ? tel.humidity    : '--';
        telGasEl.textContent  = tel.eco2        != null ? tel.eco2        : '--';

        // Recommendation
        recTextEl.textContent = data.recommendation || (isFresh
            ? 'This tomato is in excellent condition. Safe for consumption or immediate packaging and distribution.'
            : 'This tomato shows signs of spoilage. Isolate from fresh batch. Not recommended for sale or consumption.');

        // Print meta
        if (printBatch) printBatch.textContent = `Batch: ${batchKey}`;
        if (printTime)  printTime.textContent  = timeStr;

        lucide.createIcons();
    }

    // ── Reset ──
    function resetScanner() {
        isProcessing = false;
        startBtn.disabled = false;
        video.classList.remove('dimmed');
        controlsArea.classList.remove('hidden');
    }

    // ── Button Listeners ──
    document.getElementById('back-btn').addEventListener('click', () => {
        showScan();
        resetScanner();
    });

    document.getElementById('reset-btn').addEventListener('click', () => {
        showScan();
        resetScanner();
    });

    // Print buttons (both top icon and bottom action)
    ['print-pdf-btn', 'print-pdf-btn2'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => window.print());
    });

    // Save DB buttons
    ['save-db-btn', 'save-db-btn2'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => {
            alert('Ready to save to Database! Add your DB connection in backend_api.py.');
        });
    });

    // ── Init ──
    startCamera();
});
