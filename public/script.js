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
        const payload = {
            reciterId: reciterSelect.value,
            surahNumber: parseInt(surahSelect.value),
            fromAyah: parseInt(fromAyahInput.value),
            toAyah: parseInt(toAyahInput.value)
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
