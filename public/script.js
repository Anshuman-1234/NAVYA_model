document.addEventListener('DOMContentLoaded', () => {
    // Initialize Lucide Icons
    lucide.createIcons();

    // Elements
    const video = document.getElementById('camera-feed');
    const canvas = document.getElementById('snapshot-canvas');
    const startBtn = document.getElementById('start-btn');
    const resetBtn = document.getElementById('reset-btn');
    const printPdfBtn = document.getElementById('print-pdf-btn');
    const saveDbBtn = document.getElementById('save-db-btn');
    const batchKeyInput = document.getElementById('batch-key');
    const errorMsg = document.getElementById('error-msg');
    
    // Overlays & Areas
    const controlsArea = document.getElementById('controls-area');
    const countdownOverlay = document.getElementById('countdown-overlay');
    const countdownText = document.getElementById('countdown-text');
    const loadingOverlay = document.getElementById('loading-overlay');
    const resultsOverlay = document.getElementById('results-overlay');

    // Result Elements
    const freshnessScoreEl = document.getElementById('freshness-score');
    const spoilageIndexEl = document.getElementById('spoilage-index');
    const shelfLifeEl = document.getElementById('shelf-life');
    const telTempEl = document.getElementById('tel-temp');
    const telHumEl = document.getElementById('tel-hum');
    const telGasEl = document.getElementById('tel-gas');
    const recTextEl = document.getElementById('rec-text');
    const recIconEl = document.getElementById('rec-icon');

    let stream = null;
    let isProcessing = false;

    // Start Camera
    async function startCamera() {
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "environment" }
            });
            video.srcObject = stream;
        } catch (err) {
            console.error("Camera Error:", err);
            showError("Unable to access camera. Please check permissions or use HTTPS.");
        }
    }

    // Stop Camera
    function stopCamera() {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
    }

    // Show Error
    function showError(msg) {
        errorMsg.textContent = msg;
        errorMsg.classList.remove('hidden');
        setTimeout(() => errorMsg.classList.add('hidden'), 5000);
    }

    // Start Operation Handler
    startBtn.addEventListener('click', () => {
        if (!batchKeyInput.value.trim()) {
            showError("Please enter a Unique Batch Key first.");
            return;
        }
        
        if (isProcessing) return;
        isProcessing = true;
        startBtn.disabled = true;
        startBtn.textContent = "Processing...";
        
        // Hide controls, show countdown
        controlsArea.classList.add('hidden');
        countdownOverlay.classList.remove('hidden');
        
        let count = 3;
        countdownText.textContent = count;
        
        const timer = setInterval(() => {
            count -= 1;
            if (count > 0) {
                // Re-trigger animation by cloning node
                const newSpan = countdownText.cloneNode(true);
                newSpan.textContent = count;
                countdownText.parentNode.replaceChild(newSpan, countdownText);
            } else {
                clearInterval(timer);
                countdownOverlay.classList.add('hidden');
                captureAndAnalyze();
            }
        }, 1000);
    });

    // Capture Frame & Call API
    async function captureAndAnalyze() {
        // Capture logic
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Show Loading
        video.classList.add('dimmed');
        loadingOverlay.classList.remove('hidden');
        
        try {
            const payload = {
                batchKey: batchKeyInput.value,
                greenRatio: 0.02,
                redRatio: 0.85,
                darkSpotRatio: 0.01,
                moldRatio: 0.00,
                textureRoughness: 120.0
            };

            // Detect whether running standalone local dev servers or Vercel production/dev serverless API
            const apiUrl = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && window.location.port === '8000'
                ? 'http://127.0.0.1:5000/predict'
                : '/api/predict';

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json().catch(() => ({ success: false, error: 'SYSTEM FAIL: Invalid response format from server' }));

            loadingOverlay.classList.add('hidden');

            if (response.ok && data.success) {
                const isFresh = data.grade.includes('Fresh');
                
                // Populate Results UI
                freshnessScoreEl.textContent = data.freshnessScore + '%';
                freshnessScoreEl.style.color = isFresh ? '#16A34A' : '#FCA5A5';
                spoilageIndexEl.textContent = data.spoilageIndex;
                shelfLifeEl.textContent = data.shelfLifeDays;
                
                telTempEl.textContent = data.telemetry.temperature;
                telHumEl.textContent = data.telemetry.humidity;
                telGasEl.textContent = data.telemetry.eco2;
                
                recTextEl.textContent = data.recommendation;
                recIconEl.style.color = isFresh ? '#16A34A' : '#FCA5A5';
                
                // Show Results Overlay
                resultsOverlay.classList.remove('hidden');
            } else {
                const errMsg = data.error || 'SYSTEM FAIL: Hardware sensor endpoint unreachable';
                showError(errMsg);
                resetScanner();
            }

        } catch (err) {
            console.error(err);
            loadingOverlay.classList.add('hidden');
            showError("SYSTEM FAIL: Unable to connect to backend server / sensor API.");
            resetScanner();
        }
    }

    // Reset Handler
    function resetScanner() {
        isProcessing = false;
        startBtn.disabled = false;
        startBtn.textContent = "START OPERATION";
        
        resultsOverlay.classList.add('hidden');
        video.classList.remove('dimmed');
        controlsArea.classList.remove('hidden');
        batchKeyInput.value = "";
    }
    
    resetBtn.addEventListener('click', resetScanner);

    // Placeholder handlers for print and save buttons
    printPdfBtn.addEventListener('click', () => {
        window.print();
    });

    saveDbBtn.addEventListener('click', () => {
        alert("Ready to save results to Database! (Waiting for DB credentials)");
    });

    // Init
    startCamera();
});
