const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const PImage = require('pureimage');

const OUTPUT_DIR = path.join(__dirname, '../../output');
const TEMP_DIR = path.join(__dirname, '../../uploads');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

/**
 * Validates if ffmpeg is available
 */
const validateTools = async () => {
    return new Promise((resolve) => {
        ffmpeg.getAvailableFormats((err, formats) => {
            resolve(!err);
        });
    });
};

/**
 * Downloads a file from a URL
 */
const downloadFile = async (url, dest) => {
    const writer = fs.createWriteStream(dest);
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        timeout: 120000 // 120 seconds timeout (increased from 30s)
    });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
};

/**
 * Creates a text overlay image using pureimage with Arabic support
 */
const createTextOverlay = async (text, outputPath) => {
    const reshaper = require('arabic-persian-reshaper');
    const bidiFactory = require('bidi-js');
    const bidi = bidiFactory();
    
    const width = 1080;
    const height = 1920;
    const img = PImage.make(width, height);
    const ctx = img.getContext('2d');

    // Load font
    const fontPath = '/System/Library/Fonts/Supplemental/Arial.ttf';
    if (fs.existsSync(fontPath)) {
        const font = PImage.registerFont(fontPath, 'Arial');
        await new Promise((resolve) => font.load(() => resolve()));
        ctx.font = "60pt 'Arial'";
    } else {
        ctx.font = "60pt sans-serif";
    }

    // Explicitly set background to fully transparent
    // PureImage images are transparent by default, but let's be sure
    ctx.clearRect(0, 0, width, height);

    // Add a very subtle dark vignette to make white text pop
    // This also helps verify if overlay transparency is working
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'; // 30% black
    ctx.fillRect(0, height * 0.2, width, height * 0.6); // Center area backdrop

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';

    const lines = text.split('\n\n');
    let y = height / 2 - (lines.length * 60);

    lines.forEach(line => {
        if (!line.trim()) return;
        
        // 1. Reshape Arabic
        const reshaped = reshaper.ArabicShaper.convertArabic(line);
        
        // 2. Apply Bidi (RTL)
        const bidiText = bidi.getReorderedString(reshaped, bidi.getEmbeddingLevels(reshaped));
        
        // 3. Render
        ctx.fillText(bidiText, width / 2, y);
        y += 150;
    });

    await PImage.encodePNGToStream(img, fs.createWriteStream(outputPath));
    console.log('Text overlay created with Arabic support & transparency');
};

/**
 * Processes the video generation
 */
const generateReel = async (options) => {
    const { reciterId, surahNumber, fromAyah, toAyah, ayahs, backgroundPath: customBackgroundPath } = options;
    const timestamp = Date.now();
    const finalOutputPath = path.join(OUTPUT_DIR, `reel_${timestamp}.mp4`);
    
    console.log('Starting generateReel with background:', customBackgroundPath);

    // 1. Download audio files
    const audioFiles = [];
    for (const ayah of ayahs) {
        const audioUrl = `https://www.everyayah.com/data/${reciterId}/${String(surahNumber).padStart(3, '0')}${String(ayah.numberInSurah).padStart(3, '0')}.mp3`;
        const audioPath = path.join(TEMP_DIR, `audio_${timestamp}_${ayah.numberInSurah}.mp3`);
        await downloadFile(audioUrl, audioPath);
        audioFiles.push(audioPath);
    }

    // Combine audio using fluent-ffmpeg
    const combinedAudioPath = path.join(TEMP_DIR, `combined_${timestamp}.mp3`);
    const ffmpegCombine = ffmpeg();
    audioFiles.forEach(file => ffmpegCombine.input(file));
    
    await new Promise((resolve, reject) => {
        ffmpegCombine
            .on('error', reject)
            .on('end', resolve)
            .mergeToFile(combinedAudioPath, TEMP_DIR);
    });

    // 2. Prepare Background
    let backgroundPath = options.backgroundPath;
    let finalBackgroundPath = '';
    
    if (backgroundPath && fs.existsSync(backgroundPath)) {
        console.log('Using custom background file:', backgroundPath);
        const ext = path.extname(backgroundPath).toLowerCase();
        
        if (['.jpg', '.png', '.jpeg'].includes(ext)) {
            console.log('Background is image, converting to video template (loop 1)...');
            const videoPath = path.join(TEMP_DIR, `bg_vid_${timestamp}.mp4`);
            await new Promise((resolve, reject) => {
                ffmpeg()
                    .input(backgroundPath)
                    .inputOptions('-loop 1') // CRITICAL: Loop image input
                    .outputOptions([
                        '-pix_fmt yuv420p',
                        '-t 30', // 30 seconds
                        '-vf scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920'
                    ])
                    .save(videoPath)
                    .on('start', (cmd) => console.log('BG Conversion Command:', cmd))
                    .on('end', () => {
                        console.log('BG Image converted successfully');
                        finalBackgroundPath = videoPath;
                        resolve();
                    })
                    .on('error', (err) => {
                        console.error('BG Image conversion error:', err);
                        reject(err);
                    });
            });
        } else {
            console.log('Background is already a video or recognized format');
            finalBackgroundPath = backgroundPath;
        }
    }

    if (!finalBackgroundPath || !fs.existsSync(finalBackgroundPath)) {
        console.log('Creating default black background video...');
        const bgVideoPath = path.join(TEMP_DIR, `bg_black_${timestamp}.mp4`);
        await new Promise((resolve, reject) => {
            ffmpeg()
                .input('color=c=black:s=1080x1920:d=30')
                .inputFormat('lavfi')
                .outputOptions(['-pix_fmt yuv420p'])
                .save(bgVideoPath)
                .on('end', () => {
                    finalBackgroundPath = bgVideoPath;
                    resolve();
                })
                .on('error', (err) => {
                    console.error('Default BG error:', err);
                    reject(err);
                });
        });
    }

    console.log('Final background path for assembly:', finalBackgroundPath);

    // 3. Create text overlays
    const fullText = ayahs.map(a => a.text).join('\n\n');
    const overlayPath = path.join(TEMP_DIR, `overlay_${timestamp}.png`);
    await createTextOverlay(fullText, overlayPath);

    // 4. Final Assembly
    return new Promise((resolve, reject) => {
        const proc = ffmpeg()
            .input(finalBackgroundPath)
            .inputOptions(['-stream_loop -1']) 
            .input(combinedAudioPath)
            .input(overlayPath)
            .complexFilter([
                // Ensure overlay is handled as RGBA and scaled
                '[2:v]scale=1080:1920[ovl]',
                // Overlay on top of background
                '[0:v][ovl]overlay=0:0[vout]'
            ])
            .outputOptions([
                '-map [vout]',
                '-map 1:a',
                '-c:v libx264',
                '-preset ultrafast',
                '-crf 23',
                '-pix_fmt yuv420p',
                '-shortest' 
            ])
            .output(finalOutputPath)
            .on('start', (cmd) => console.log('FFmpeg Final Command:', cmd))
            .on('end', () => {
                console.log('Video generation complete:', finalOutputPath);
                resolve(finalOutputPath);
            })
            .on('error', (err, stdout, stderr) => {
                console.error('Final FFmpeg Error:', err);
                console.error('FFmpeg Stderr:', stderr);
                reject(err);
            });
            
        proc.run();
    });
};

module.exports = {
    validateTools,
    generateReel
};
