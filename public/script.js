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

    // Forecast Elements
    const forecastWarningDate = document.getElementById('forecast-warning-date');
    const forecastSpoilDate   = document.getElementById('forecast-spoil-date');
    const forecastChartCanvas = document.getElementById('forecastChart');
    let degradationChart      = null;

    // Print elements
    const printBatch = document.getElementById('print-batch');
    const printTime  = document.getElementById('print-time');

    // Not-Tomato Modal elements
    const notTomatoModal  = document.getElementById('not-tomato-modal');
    const notTomatoCard   = document.getElementById('not-tomato-card');
    const ntPreviewImg    = document.getElementById('nt-preview-img');
    const ntRetryBtn      = document.getElementById('nt-retry-btn');

    let stream = null;
    let isProcessing = false;
    let snapshotDataUrl = '';

    // Global live MQTT snapshot (updated every message)
    let liveSensor = { temperature: null, humidity: null, eco2: null, tvoc: null };

    // Additional report element
    const telTvocEl = document.getElementById('tel-tvoc');

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

    // ── Not-Tomato Detection ──
    /**
     * Checks whether the captured image contains a tomato by analyzing
     * the ratio of tomato-colored pixels (red, orange-red, or green).
     * Returns true if the image is likely a tomato, false otherwise.
     */
    function isTomato(imageData, totalPixels) {
        let tomatoPx = 0;
        for (let i = 0; i < imageData.length; i += 4) {
            const r = imageData[i];
            const g = imageData[i + 1];
            const b = imageData[i + 2];

            // Ripe red / orange-red tomato
            const isRed    = r > 110 && r > g + 35 && r > b + 35;
            // Unripe green tomato
            const isGreen  = g > 90  && g > r + 20 && g > b + 10;
            // Orange tomato (some varieties)
            const isOrange = r > 160 && g > 80 && g < 160 && b < 80;

            if (isRed || isGreen || isOrange) tomatoPx++;
        }
        // At least 15% of all pixels must be tomato-colored
        return (tomatoPx / totalPixels) >= 0.15;
    }

    /**
     * Shows the not-tomato warning modal with the captured image preview.
     */
    function showNotTomatoAlert(previewUrl) {
        ntPreviewImg.src = previewUrl;
        notTomatoModal.classList.remove('hidden');
        // Trigger shake after card enter animation
        setTimeout(() => {
            notTomatoCard.classList.add('shake');
            notTomatoCard.addEventListener('animationend', () => {
                notTomatoCard.classList.remove('shake');
            }, { once: true });
        }, 380);
        lucide.createIcons();
    }

    /**
     * Hides the not-tomato modal and resets the scanner state.
     */
    function hideNotTomatoModal() {
        notTomatoModal.classList.add('hidden');
        ntPreviewImg.src = '';
        resetScanner();
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

            // ── Layer 1: Frontend tomato pixel check ──
            // Runs instantly before any API call.
            if (!isTomato(imgData, total)) {
                loadingOverlay.classList.add('hidden');
                video.classList.remove('dimmed');
                showNotTomatoAlert(snapshotDataUrl);
                // Do NOT reset isProcessing here — modal's retry button handles it.
                return;
            }

            const payload = {
                batchKey:        batchKeyInput.value.trim(),
                greenRatio:      parseFloat((greenPx / total).toFixed(4)),
                redRatio:        parseFloat((redPx   / total).toFixed(4)),
                darkSpotRatio:   parseFloat((darkPx  / total).toFixed(4)),
                moldRatio:       0.00,
                textureRoughness: 110.0,
                // Pass the live MQTT values collected by the frontend WebSocket
                sensor_temperature: liveSensor.temperature,
                sensor_humidity:    liveSensor.humidity,
                sensor_eco2:        liveSensor.eco2,
                sensor_tvoc:        liveSensor.tvoc
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
            } else if (data.not_tomato) {
                // ── Layer 2: Backend not-tomato guard ──
                showNotTomatoAlert(snapshotDataUrl);
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

        // Telemetry — prefer live MQTT, fallback to API response
        const tel = data.telemetry || {};
        const dispTemp = liveSensor.temperature != null ? liveSensor.temperature : tel.temperature;
        const dispHum  = liveSensor.humidity    != null ? liveSensor.humidity    : tel.humidity;
        const dispEco2 = liveSensor.eco2        != null ? liveSensor.eco2        : tel.eco2;
        const dispTvoc = liveSensor.tvoc        != null ? liveSensor.tvoc        : null;

        telTempEl.textContent = dispTemp != null ? dispTemp : '--';
        telHumEl.textContent  = dispHum  != null ? dispHum  : '--';
        telGasEl.textContent  = dispEco2 != null ? dispEco2 : '--';
        if (telTvocEl) telTvocEl.textContent = dispTvoc != null ? dispTvoc : '--';

        // Recommendation
        recTextEl.textContent = data.recommendation || (isFresh
            ? 'This tomato is in excellent condition. Safe for consumption or immediate packaging and distribution.'
            : 'This tomato shows signs of spoilage. Isolate from fresh batch. Not recommended for sale or consumption.');

        // Print meta
        if (printBatch) printBatch.textContent = `Batch: ${batchKey}`;
        if (printTime)  printTime.textContent  = timeStr;

        // ── Forecast Timeline & Chart ──
        const warningDays = Math.max(1, Math.floor(shelfDays * 0.7));
        
        const dateWarning = new Date(now);
        dateWarning.setDate(dateWarning.getDate() + warningDays);
        
        const dateSpoil = new Date(now);
        dateSpoil.setDate(dateSpoil.getDate() + shelfDays);
        
        const formatOptions = { month: 'short', day: 'numeric' };
        forecastWarningDate.textContent = dateWarning.toLocaleDateString('en-IN', formatOptions);
        forecastSpoilDate.textContent   = dateSpoil.toLocaleDateString('en-IN', formatOptions);

        if (degradationChart) {
            degradationChart.destroy();
        }

        // Simple curve points: Today -> mid -> warning -> spoiled
        const labels = ['Today', `+${Math.floor(warningDays/2)}d`, `Use By`, `Spoiled`];
        const dataPoints = [
            freshScore,
            Math.max(0, freshScore - (freshScore * 0.2)),
            Math.max(0, freshScore - (freshScore * 0.6)),
            0
        ];

        const ctx = forecastChartCanvas.getContext('2d');
        degradationChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Freshness Forecast (%)',
                    data: dataPoints,
                    borderColor: '#3B82F6',
                    backgroundColor: 'rgba(59, 130, 246, 0.15)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true,
                    pointBackgroundColor: ['#16A34A', '#3B82F6', '#F59E0B', '#EF4444'],
                    pointBorderColor: '#0F1519',
                    pointBorderWidth: 2,
                    pointRadius: 6,
                    pointHoverRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { 
                        beginAtZero: true, 
                        max: 100,
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#8A9BAD', font: { size: 10, family: 'Inter' } }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#8A9BAD', font: { size: 10, family: 'Inter', weight: 600 } }
                    }
                }
            }
        });

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

    // Not-tomato modal retry button
    ntRetryBtn.addEventListener('click', hideNotTomatoModal);

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

    // ── Live Telemetry WebSocket ──
    const liveTemp = document.getElementById('live-temp');
    const liveHum = document.getElementById('live-hum');
    const liveEco2 = document.getElementById('live-eco2');

    function connectLiveTelemetry() {
        if (typeof mqtt === 'undefined') {
            console.warn("MQTT.js not loaded.");
            return;
        }
        console.log("Connecting to Live MQTT WebSockets...");
        // Use WSS (Secure WebSockets) on port 8884 to avoid Mixed Content errors on HTTPS (Vercel)
        const client = mqtt.connect('wss://broker.hivemq.com:8884/mqtt');

        client.on('connect', () => {
            console.log("Connected to HiveMQ WebSockets!");
            client.subscribe('navya/anshuman/sensors');
        });

        client.on('message', (topic, message) => {
            try {
                const data = JSON.parse(message.toString());
                // Update global live sensor store
                if (data.temperature != null) {
                    liveSensor.temperature = data.temperature;
                    liveTemp.textContent = data.temperature.toFixed(1);
                }
                if (data.humidity != null) {
                    liveSensor.humidity = data.humidity;
                    liveHum.textContent = data.humidity.toFixed(1);
                }
                if (data.eco2 != null) {
                    liveSensor.eco2 = data.eco2;
                    liveEco2.textContent = data.eco2;
                }
                if (data.tvoc != null) {
                    liveSensor.tvoc = data.tvoc;
                }
            } catch(e) {
                console.error("Invalid live MQTT JSON", e);
            }
        });
    }

    // ── Init ──
    startCamera();
    connectLiveTelemetry();
});
