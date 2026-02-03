document.addEventListener('DOMContentLoaded', async () => {
    const reciterSelect = document.getElementById('reciter');
    const surahSelect = document.getElementById('surah');
    const generateBtn = document.getElementById('generateBtn');
    const resultSection = document.getElementById('resultSection');
    const loader = document.getElementById('loader');
    const videoPreview = document.getElementById('videoPreview');
    const outputVideo = document.getElementById('outputVideo');
    const downloadBtn = document.getElementById('downloadBtn');
    const fromAyahInput = document.getElementById('fromAyah');
    const toAyahInput = document.getElementById('toAyah');
    const backgroundInput = document.getElementById('background');
    const fileNameDisplay = document.getElementById('fileName');

    // Handle background file selection UI
    backgroundInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            fileNameDisplay.textContent = file.name;
        } else {
            fileNameDisplay.textContent = 'لم يتم اختيار ملف';
        }
    });

    // Fetch initial data
    try {
        const res = await fetch('/api/initial-data');
        const data = await res.json();

        // Populate Reciters
        reciterSelect.innerHTML = data.reciters.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
        
        // Populate Surahs
        surahSelect.innerHTML = data.surahs.map(s => `<option value="${s.number}">${s.number}. ${s.name}</option>`).join('');
    } catch (err) {
        console.error('Failed to load initial data:', err);
    }

    // Handle Generation
    generateBtn.addEventListener('click', async () => {
        const backgroundFile = document.getElementById('background').files[0];
        
        let backgroundData = null;
        
        // Convert image to base64 if selected
        if (backgroundFile) {
            const reader = new FileReader();
            backgroundData = await new Promise((resolve) => {
                reader.onload = (e) => resolve(e.target.result);
                reader.readAsDataURL(backgroundFile);
            });
        }
        
        const payload = {
            reciterId: reciterSelect.value,
            surahNumber: parseInt(surahSelect.value),
            fromAyah: parseInt(fromAyahInput.value),
            toAyah: parseInt(toAyahInput.value),
            backgroundData: backgroundData
        };

        if (!payload.reciterId || !payload.surahNumber) {
            alert('يرجى ملء جميع البيانات');
            return;
        }

        generateBtn.disabled = true;
        resultSection.classList.remove('hidden');
        loader.classList.remove('hidden');
        videoPreview.classList.add('hidden');

        try {
            const res = await fetch('/api/generate-video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (data.success) {
                outputVideo.src = data.videoUrl;
                downloadBtn.href = data.videoUrl;
                loader.classList.add('hidden');
                videoPreview.classList.remove('hidden');
            } else {
                throw new Error(data.error);
            }
        } catch (err) {
            alert('حدث خطأ أثناء توليد الفيديو: ' + err.message);
            resultSection.classList.add('hidden');
        } finally {
            generateBtn.disabled = false;
        }
    });
});
