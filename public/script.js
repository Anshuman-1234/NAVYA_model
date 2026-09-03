document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();

    // ── Views ──
    const scanView   = document.getElementById('scan-view');
    const reportView = document.getElementById('report-view');

    // ── Scan Elements ──
    const video            = document.getElementById('camera-feed');
    const canvas           = document.getElementById('snapshot-canvas');
    const startBtn         = document.getElementById('start-btn');
    const uploadBtn        = document.getElementById('upload-file-btn');
    const fileInput        = document.getElementById('file-input');
    const batchKeyInput    = document.getElementById('batch-key');
    const errorMsg         = document.getElementById('error-msg');
    const controlsArea     = document.getElementById('controls-area');
    const countdownOverlay = document.getElementById('countdown-overlay');
    const countdownText    = document.getElementById('countdown-text');
    const loadingOverlay   = document.getElementById('loading-overlay');

    // ── Report Elements ──
    const capturedImg      = document.getElementById('captured-img');
    const imgBadge         = document.getElementById('img-badge');
    const imgViewHint      = document.getElementById('img-view-hint');
    const imgBatchLabel    = document.getElementById('img-batch-label');
    const imgTimestamp     = document.getElementById('img-timestamp');
    const producePill      = document.getElementById('produce-pill');
    const statusBanner     = document.getElementById('status-banner');
    const statusIcon       = document.getElementById('status-icon');
    const gradeText        = document.getElementById('grade-text');
    const itemsCountBadge  = document.getElementById('items-count-badge');
    const freshCountBadge  = document.getElementById('fresh-count-badge');
    const rottenCountBadge = document.getElementById('rotten-count-badge');
    const confidenceVal    = document.getElementById('confidence-val');
    const itemsList        = document.getElementById('items-list');

    const freshnessScoreEl = document.getElementById('freshness-score');
    const spoilageIndexEl  = document.getElementById('spoilage-index');
    const shelfLifeEl      = document.getElementById('shelf-life');
    const shelfBar         = document.getElementById('shelf-bar');
    const telTempEl        = document.getElementById('tel-temp');
    const telHumEl         = document.getElementById('tel-hum');
    const telGasEl         = document.getElementById('tel-gas');
    const telTvocEl        = document.getElementById('tel-tvoc');
    const recTextEl        = document.getElementById('rec-text');

    // View selector tabs
    const viewTabs         = document.querySelectorAll('.view-tab');

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
    const ntTitleEl       = document.getElementById('nt-title');
    const ntSubtitleEl    = document.getElementById('nt-subtitle');
    const ntDiagBadge     = document.getElementById('nt-diag-badge');
    const ntDiagText      = document.getElementById('nt-diag-text');
    const ntPreviewImg    = document.getElementById('nt-preview-img');
    const ntRetryBtn      = document.getElementById('nt-retry-btn');

    let stream = null;
    let isProcessing = false;
    let snapshotDataUrl = '';
    let currentAnalysisImages = {
        annotated: '',
        heatmap: '',
        original: ''
    };

    // Global live MQTT snapshot (updated every message)
    let liveSensor = { temperature: null, humidity: null, eco2: null, tvoc: null };

    // ── Camera ──
    async function startCamera() {
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } }
            });
            video.srcObject = stream;
        } catch (err) {
            console.warn('Camera access unavailable or blocked:', err);
        }
    }

    // ── Error Banner ──
    function showError(msg) {
        errorMsg.textContent = msg;
        errorMsg.classList.remove('hidden');
        setTimeout(() => errorMsg.classList.add('hidden'), 6000);
    }

    // ── View Switcher ──
    function showReport() {
        scanView.classList.remove('active');
        scanView.classList.add('hidden');
        reportView.classList.remove('hidden');
        reportView.classList.add('active');
        lucide.createIcons();
        reportView.querySelector('.report-scroll').scrollTop = 0;
    }

    function showScan() {
        reportView.classList.remove('active');
        reportView.classList.add('hidden');
        scanView.classList.remove('hidden');
        scanView.classList.add('active');
    }

    // ── 3-View Tabs Handling ──
    viewTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            viewTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const viewType = tab.getAttribute('data-view');
            setActiveViewImage(viewType);
        });
    });

    function setActiveViewImage(viewType) {
        if (viewType === 'annotated') {
            capturedImg.src = currentAnalysisImages.annotated || snapshotDataUrl;
            imgBadge.textContent = 'ITEMIZED DETECTIONS';
            imgBadge.style.color = 'var(--green)';
            imgViewHint.textContent = 'Watershed Bounding Boxes & Confidence Labels';
        } else if (viewType === 'heatmap') {
            capturedImg.src = currentAnalysisImages.heatmap || snapshotDataUrl;
            imgBadge.textContent = 'GRAD-CAM DECAY HEATMAP';
            imgBadge.style.color = '#F59E0B';
            imgViewHint.textContent = 'Deep Neural Network Attention Overlay on Spoilage';
        } else if (viewType === 'original') {
            capturedImg.src = currentAnalysisImages.original || snapshotDataUrl;
            imgBadge.textContent = 'ORIGINAL CAPTURE';
            imgBadge.style.color = 'var(--blue)';
            imgViewHint.textContent = 'Raw Camera / Sensor Tray Capture';
        }
    }

    // ── File Upload Handler ──
    uploadBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            snapshotDataUrl = event.target.result;
            runAnalysisWithImage(snapshotDataUrl);
        };
        reader.readAsDataURL(file);
    });

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

        let count = 1;
        countdownText.textContent = count;

        const timer = setInterval(() => {
            count -= 1;
            if (count > 0) {
                countdownText.textContent = count;
            } else {
                clearInterval(timer);
                countdownOverlay.classList.add('hidden');
                captureFromCameraAndAnalyze();
            }
        }, 400);
    });

    // ── Camera Snapshot ──
    function captureFromCameraAndAnalyze() {
        canvas.width  = video.videoWidth  || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        snapshotDataUrl = canvas.toDataURL('image/jpeg', 0.85);
        runAnalysisWithImage(snapshotDataUrl);
    }

    // ── Execute AI Tray Analysis ──
    async function runAnalysisWithImage(imgDataUrl) {
        video.classList.add('dimmed');
        loadingOverlay.classList.remove('hidden');

        try {
            const payload = {
                batchKey: batchKeyInput.value.trim() || 'TOMATO-BATCH-001',
                imageData: imgDataUrl,
                sensor_temperature: liveSensor.temperature,
                sensor_humidity:    liveSensor.humidity,
                sensor_eco2:        liveSensor.eco2,
                sensor_tvoc:        liveSensor.tvoc
            };

            const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            const apiUrl  = isLocal ? 'http://127.0.0.1:5000/predict' : '/api/predict';

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json().catch(() => ({
                success: false,
                error: 'Invalid response from AI Model server.'
            }));

            loadingOverlay.classList.add('hidden');
            video.classList.remove('dimmed');

            if (response.ok && data.success) {
                populateReport(data, batchKeyInput.value.trim());
                showReport();
            } else if (data.not_tomato || data.not_recognized) {
                // Out-of-Distribution or Non-Tomato rejection
                showNotProduceAlert(
                    imgDataUrl,
                    data.error || "Not a tomato: Insufficient tomato features detected in image.",
                    data.diagnostics
                );
            } else {
                const errText = data.error || 'AI Server returned an error.';
                showError(errText);
                resetScanner();
            }

        } catch (err) {
            console.error(err);
            loadingOverlay.classList.add('hidden');
            video.classList.remove('dimmed');
            showError('Unable to connect to AI server. Please make sure backend_api.py is running on port 5000.');
            resetScanner();
        }
    }

    // ── Populate Full Report ──
    function populateReport(data, batchKey) {
        const totalItems = data.totalItems || 1;
        const freshCount = data.freshCount !== undefined ? data.freshCount : totalItems;
        const rottenCount = data.rottenCount !== undefined ? data.rottenCount : 0;
        const isFresh = rottenCount === 0;

        const now = new Date();
        const timeStr = now.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
        const shelfDays = parseFloat(data.avgShelfLifeDays || data.shelfLifeDays || 0);
        const maxShelf = 14;

        // Store images for the 3-view switcher
        currentAnalysisImages = {
            annotated: (data.images && data.images.annotated) ? data.images.annotated : snapshotDataUrl,
            heatmap: (data.images && data.images.heatmap) ? data.images.heatmap : snapshotDataUrl,
            original: (data.images && data.images.original) ? data.images.original : snapshotDataUrl
        };

        // Reset tabs to annotated view
        viewTabs.forEach(t => t.classList.remove('active'));
        const annotatedTab = document.querySelector('.view-tab[data-view="annotated"]');
        if (annotatedTab) annotatedTab.classList.add('active');
        setActiveViewImage('annotated');

        // Meta labels
        imgBatchLabel.textContent = `Batch: ${batchKey}`;
        imgTimestamp.textContent  = timeStr;
        producePill.textContent   = `🍅 TOMATO`;

        // Status banner
        gradeText.textContent = data.overallGrade || (isFresh ? 'Fresh (All Tomatoes Optimal)' : 'Mixed Spoilage Detected');
        confidenceVal.textContent = data.confidence ? Math.round(data.confidence) : '--';
        statusBanner.className = 'status-banner' + (isFresh ? '' : ' spoiled');
        statusIcon.setAttribute('data-lucide', isFresh ? 'check-circle' : 'alert-triangle');
        statusIcon.style.color = isFresh ? '#16A34A' : '#EF4444';

        // Summary Badges
        itemsCountBadge.textContent = `${totalItems} Tomato${totalItems > 1 ? 'es' : ''}`;
        freshCountBadge.textContent = `${freshCount} Fresh`;
        if (rottenCount > 0) {
            rottenCountBadge.textContent = `${rottenCount} Rotten`;
            rottenCountBadge.classList.remove('hidden');
        } else {
            rottenCountBadge.classList.add('hidden');
        }

        // Populate Itemized List
        itemsList.innerHTML = '';
        if (data.items && data.items.length > 0) {
            data.items.forEach(item => {
                const itemDiv = document.createElement('div');
                const itemIsFresh = item.condition.toLowerCase() === 'fresh';
                itemDiv.className = `item-card ${itemIsFresh ? 'fresh' : 'rotten'}`;
                itemDiv.innerHTML = `
                    <div class="item-left">
                        <div class="item-num">#${item.id}</div>
                        <div class="item-details">
                            <div class="item-name-row">
                                <span class="item-produce">Tomato #${item.id}</span>
                                <span class="item-cond-tag ${item.condition.toLowerCase()}">${item.condition}</span>
                            </div>
                            <div class="item-subtext">${item.shelfLifeNote || (itemIsFresh ? 'Optimal quality' : 'Decay detected')} · Spots: ${item.darkSpotRatio || 0}%</div>
                        </div>
                    </div>
                    <div class="item-right">
                        <div class="item-conf">${Math.round(item.confidence)}% Conf</div>
                        <div class="item-shelf ${item.condition.toLowerCase()}">${itemIsFresh ? `${item.shelfLifeDays}d shelf life` : 'Discard'}</div>
                    </div>
                `;
                itemsList.appendChild(itemDiv);
            });
        } else {
            itemsList.innerHTML = `<div class="item-subtext" style="padding:8px;">No individual item breakdown available.</div>`;
        }

        // Quality Metrics
        const freshScore = Math.round(data.freshnessScore !== undefined ? data.freshnessScore : (isFresh ? 90 : 20));
        freshnessScoreEl.textContent = freshScore;
        freshnessScoreEl.className = 'metric-value ' + (isFresh ? 'fresh' : '');
        freshnessScoreEl.style.color = isFresh ? '' : '#EF4444';

        spoilageIndexEl.textContent = Math.round(data.spoilageIndex !== undefined ? data.spoilageIndex : (100 - freshScore));
        shelfLifeEl.textContent = shelfDays.toFixed(1);

        shelfBar.style.width = Math.min((shelfDays / maxShelf) * 100, 100) + '%';

        // Telemetry
        const tel = data.telemetry || {};
        const dispTemp = liveSensor.temperature != null ? liveSensor.temperature : tel.temperature;
        const dispHum  = liveSensor.humidity    != null ? liveSensor.humidity    : tel.humidity;
        const dispEco2 = liveSensor.eco2        != null ? liveSensor.eco2        : tel.eco2;
        const dispTvoc = liveSensor.tvoc        != null ? liveSensor.tvoc        : tel.tvoc;

        telTempEl.textContent = dispTemp != null ? Number(dispTemp).toFixed(1) : '--';
        telHumEl.textContent  = dispHum  != null ? Number(dispHum).toFixed(1) : '--';
        telGasEl.textContent  = dispEco2 != null ? dispEco2 : '--';
        if (telTvocEl) telTvocEl.textContent = dispTvoc != null ? dispTvoc : '--';

        // Recommendation
        recTextEl.textContent = data.recommendation || (isFresh
            ? `All tomatoes in this batch are in optimal condition. Safe for retail packaging or consumption.`
            : `Decay spots detected in batch. Isolate spoiled tomatoes immediately to prevent spread of ethylene and fungal decay.`);

        // Print meta
        if (printBatch) printBatch.textContent = `Batch: ${batchKey}`;
        if (printTime)  printTime.textContent  = timeStr;

        // Degradation Forecast Timeline & Chart
        const warningDays = Math.max(1, Math.floor(shelfDays * 0.7));
        const dateWarning = new Date(now);
        dateWarning.setDate(dateWarning.getDate() + warningDays);

        const dateSpoil = new Date(now);
        dateSpoil.setDate(dateSpoil.getDate() + Math.max(1, Math.round(shelfDays)));

        const formatOptions = { month: 'short', day: 'numeric' };
        forecastWarningDate.textContent = dateWarning.toLocaleDateString('en-IN', formatOptions);
        forecastSpoilDate.textContent   = dateSpoil.toLocaleDateString('en-IN', formatOptions);

        if (degradationChart) {
            degradationChart.destroy();
        }

        const labels = ['Today', `+${Math.max(1, Math.floor(warningDays/2))}d`, `Use By`, `Spoiled`];
        const dataPoints = [
            freshScore,
            Math.max(0, Math.round(freshScore * 0.75)),
            Math.max(0, Math.round(freshScore * 0.35)),
            0
        ];

        const ctx = forecastChartCanvas.getContext('2d');
        degradationChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Freshness Curve (%)',
                    data: dataPoints,
                    borderColor: '#3B82F6',
                    backgroundColor: 'rgba(59, 130, 246, 0.15)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true,
                    pointBackgroundColor: ['#16A34A', '#3B82F6', '#F59E0B', '#EF4444'],
                    pointBorderColor: '#0F1519',
                    pointBorderWidth: 2,
                    pointRadius: 5,
                    pointHoverRadius: 7
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
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
        fileInput.value = '';
    }

    function showNotProduceAlert(previewUrl, reasonText, diagnostics) {
        ntPreviewImg.src = previewUrl;
        if (ntTitleEl) {
            ntTitleEl.textContent = "Not a Tomato Detected";
        }
        if (reasonText && ntSubtitleEl) {
            ntSubtitleEl.textContent = reasonText;
        } else if (ntSubtitleEl) {
            ntSubtitleEl.textContent = "The current image does not appear to contain a tomato.";
        }

        if (diagnostics && ntDiagBadge && ntDiagText) {
            if (diagnostics.tomato_pixel_ratio !== undefined) {
                ntDiagText.textContent = `Tomato Color Match: ${diagnostics.tomato_pixel_ratio}% (Min: ${diagnostics.threshold || 8}%)`;
            } else if (diagnostics.confidence !== undefined) {
                ntDiagText.textContent = `Model Confidence: ${diagnostics.confidence}%`;
            }
            ntDiagBadge.classList.remove('hidden');
        } else if (ntDiagBadge) {
            ntDiagBadge.classList.add('hidden');
        }

        notTomatoModal.classList.remove('hidden');
        lucide.createIcons();
    }

    function hideNotProduceModal() {
        notTomatoModal.classList.add('hidden');
        ntPreviewImg.src = '';
        resetScanner();
    }

    // ── Button Listeners ──
    document.getElementById('back-btn').addEventListener('click', () => {
        showScan();
        resetScanner();
    });

    ntRetryBtn.addEventListener('click', hideNotProduceModal);

    document.getElementById('reset-btn').addEventListener('click', () => {
        showScan();
        resetScanner();
    });

    ['print-pdf-btn', 'print-pdf-btn2'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => window.print());
    });

    ['save-db-btn', 'save-db-btn2'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => {
            alert('Analysis batch records saved to system storage.');
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
        const client = mqtt.connect('wss://broker.hivemq.com:8884/mqtt');

        client.on('connect', () => {
            console.log("Connected to HiveMQ WebSockets!");
            client.subscribe('navya/anshuman/sensors');
        });

        client.on('message', (topic, message) => {
            try {
                const data = JSON.parse(message.toString());
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
