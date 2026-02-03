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
    let fontSize = 70; // Slightly larger font
    if (fs.existsSync(fontPath)) {
        const font = PImage.registerFont(fontPath, 'Arial');
        await new Promise((resolve) => font.load(() => resolve()));
        ctx.font = `${fontSize}pt 'Arial'`;
    } else {
        ctx.font = `${fontSize}pt sans-serif`;
    }

    ctx.clearRect(0, 0, width, height);

    // Render configuration
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    const maxWidth = width * 0.8; // 80% of width for text
    const lineHeight = fontSize * 1.5;

    // Word Wrap and Process Arabic
    const processArabicText = (rawText) => {
        const reshaped = reshaper.ArabicShaper.convertArabic(rawText);
        return bidi.getReorderedString(reshaped, bidi.getEmbeddingLevels(reshaped));
    };

    const wrapText = (text, maxWidth) => {
        const words = text.split(' ');
        const lines = [];
        let currentLine = words[0];

        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const testLine = currentLine + " " + word;
            // Note: PureImage measureText is basic, using a rough estimate if it fails
            const metrics = ctx.measureText(processArabicText(testLine));
            if (metrics.width > maxWidth) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        lines.push(currentLine);
        return lines;
    };

    const paragraphs = text.split('\n\n');
    let allRenderLines = [];
    
    paragraphs.forEach(p => {
        const wrappedLines = wrapText(p.trim(), maxWidth);
        allRenderLines = allRenderLines.concat(wrappedLines);
        allRenderLines.push(""); // Spacer between ayahs
    });

    // Remove last spacer
    if (allRenderLines.length > 0 && allRenderLines[allRenderLines.length-1] === "") {
        allRenderLines.pop();
    }

    // Calculate vertical centering
    const totalTextHeight = allRenderLines.length * lineHeight;
    let y = (height - totalTextHeight) / 2 + lineHeight;

    // Background backdrop for readability
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    const bgPadding = 60;
    ctx.fillRect(width * 0.05, (height - totalTextHeight) / 2 - bgPadding, width * 0.9, totalTextHeight + bgPadding * 2);

    // Render lines
    ctx.fillStyle = '#ffffff';
    allRenderLines.forEach(line => {
        if (line.trim()) {
            const bidiLine = processArabicText(line);
            ctx.fillText(bidiLine, width / 2, y);
        }
        y += lineHeight;
    });

    await PImage.encodePNGToStream(img, fs.createWriteStream(outputPath));
    console.log('Text overlay created with wrapping and layout optimization');
};

/**
 * Fetches a random nature background from LoremFlickr
 */
const fetchRandomBackground = async (outputPath) => {
    console.log('Fetching random nature background from LoremFlickr...');
    // Using nature, landscape, and sky tags to get relevant serenity
    const url = 'https://loremflickr.com/1080/1920/nature,landscape,sky/all';
    try {
        await downloadFile(url, outputPath);
        console.log('Random background fetched successfully');
        return true;
    } catch (error) {
        console.error('Failed to fetch random background:', error);
        return false;
    }
};

/**
 * Processes the video generation
 */
const generateReel = async (options) => {
    const { reciterId, surahNumber, fromAyah, toAyah, ayahs, backgroundPath: customBackgroundPath } = options;
    const timestamp = Date.now();
    const finalOutputPath = path.join(OUTPUT_DIR, `reel_${timestamp}.mp4`);
    
    console.log('Starting generateReel. Custom background:', customBackgroundPath || 'None');

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
    
    // Case 1: User provides a background
    if (backgroundPath && fs.existsSync(backgroundPath)) {
        console.log('Processing custom background:', backgroundPath);
    } else {
        // Case 2: No custom background, fetch a random one
        console.log('No custom background, fetching random nature image...');
        const randomImgPath = path.join(TEMP_DIR, `random_bg_${timestamp}.jpg`);
        const success = await fetchRandomBackground(randomImgPath);
        if (success) {
            backgroundPath = randomImgPath;
        }
    }

    // Now process backgroundPath (whether custom or random)
    if (backgroundPath && fs.existsSync(backgroundPath)) {
        const ext = path.extname(backgroundPath).toLowerCase();
        
        if (['.jpg', '.png', '.jpeg'].includes(ext)) {
            console.log('Converting background image to video template...');
            const videoPath = path.join(TEMP_DIR, `bg_vid_${timestamp}.mp4`);
            await new Promise((resolve, reject) => {
                ffmpeg()
                    .input(backgroundPath)
                    .inputOptions('-loop 1')
                    .outputOptions([
                        '-pix_fmt yuv420p',
                        '-t 30',
                        '-vf scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920'
                    ])
                    .save(videoPath)
                    .on('end', () => {
                        finalBackgroundPath = videoPath;
                        resolve();
                    })
                    .on('error', (err) => {
                        console.error('BG Image conversion error:', err);
                        reject(err);
                    });
            });
        } else {
            finalBackgroundPath = backgroundPath;
        }
    }

    // Final Fallback: Black background if everything fails
    if (!finalBackgroundPath || !fs.existsSync(finalBackgroundPath)) {
        console.log('Using default black background template...');
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
                .on('error', reject);
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
