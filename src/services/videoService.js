const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const PImage = require('pureimage');

const OUTPUT_DIR = path.join(__dirname, '../../output');
const TEMP_DIR = path.join(__dirname, '../../uploads');
const AUDIO_CACHE_DIR = path.join(__dirname, '../../audio_cache');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);
if (!fs.existsSync(AUDIO_CACHE_DIR)) fs.mkdirSync(AUDIO_CACHE_DIR);

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
 * Gets the duration of a media file in seconds
 */
const getMediaDuration = async (filePath) => {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) reject(err);
            else resolve(metadata.format.duration);
        });
    });
};

/**
 * Downloads a file from a URL with improved resilience
 */
const downloadFile = async (url, dest) => {
    const writer = fs.createWriteStream(dest);
    try {
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream',
            timeout: 120000, // 120 seconds
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        
        if (response.status !== 200) {
            throw new Error(`Failed to download: HTTP ${response.status}`);
        }

        response.data.pipe(writer);
        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', (err) => {
                fs.unlink(dest, () => {}); // Clean up partial file
                reject(err);
            });
        });
    } catch (error) {
        fs.unlink(dest, () => {}); // Clean up
        throw error;
    }
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
    
    console.log('Starting generateReel. Resilience mode enabled.');

    // 1. Download audio files with caching
    const audioFiles = [];
    const durations = [];
    for (const ayah of ayahs) {
        const cacheFileName = `${reciterId}_${String(surahNumber).padStart(3, '0')}${String(ayah.numberInSurah).padStart(3, '0')}.mp3`;
        const cachePath = path.join(AUDIO_CACHE_DIR, cacheFileName);
        const audioPath = path.join(TEMP_DIR, `audio_${timestamp}_${ayah.numberInSurah}.mp3`);
        
        if (!fs.existsSync(cachePath)) {
            const audioUrl = `https://www.everyayah.com/data/${reciterId}/${String(surahNumber).padStart(3, '0')}${String(ayah.numberInSurah).padStart(3, '0')}.mp3`;
            try {
                await downloadFile(audioUrl, cachePath);
            } catch (e) {
                console.warn(`Download failed for Ayah ${ayah.numberInSurah}, seeking local fallback...`);
                // Check uploads for any existing file from previous runs
                const uploaded = fs.readdirSync(TEMP_DIR).find(f => f.includes(`_${ayah.numberInSurah}.mp3`));
                if (uploaded) {
                    fs.copyFileSync(path.join(TEMP_DIR, uploaded), cachePath);
                }
            }
        }

        if (fs.existsSync(cachePath)) {
            fs.copyFileSync(cachePath, audioPath);
            const dur = await getMediaDuration(audioPath);
            audioFiles.push(audioPath);
            durations.push(dur);
        } else {
            throw new Error(`تعذر تحميل الصوت للآية ${ayah.numberInSurah}. تأكد من اتصال الإنترنت.`);
        }
    }

    const totalDuration = durations.reduce((a, b) => a + b, 0);

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
    let isAnimatedVideo = false;
    
    // Priority 1: User Custom Background
    if (backgroundPath && fs.existsSync(backgroundPath)) {
        console.log('Processing custom background:', backgroundPath);
        const ext = path.extname(backgroundPath).toLowerCase();
        if (['.mp4', '.mov', '.avi'].includes(ext)) isAnimatedVideo = true;
    } else {
        // Priority 2: Fetch Random Nature Image (JPG) from Internet
        console.log('Seeking nature image background from LoremFlickr/Picsum...');
        const natureImgPath = path.join(TEMP_DIR, `nature_img_${timestamp}.jpg`);
        
        let imgSuccess = await fetchRandomBackground(natureImgPath);
        
        // Backup image source: Picsum
        if (!imgSuccess) {
            console.log('LoremFlickr failed, trying Picsum...');
            try {
                await downloadFile('https://picsum.photos/1080/1920?nature,landscape', natureImgPath);
                imgSuccess = true;
            } catch (e) {
                console.warn('Picsum also failed:', e.message);
            }
        }

        if (imgSuccess) {
            backgroundPath = natureImgPath;
            isAnimatedVideo = false;
        } else {
            // No custom background and internet fetch failed
            // Throwing a clear error as requested by the user instead of silent fallback
            throw new Error('تعذر جلب صور مناظر طبيعية من الإنترنت. يرجى التأكد من اتصال الإنترنت في الـ Terminal أو رفع خلفية مخصصة.');
        }
    }

    // Process background into a video of correct duration and dimensions
    if (backgroundPath && fs.existsSync(backgroundPath)) {
        const bgVidPath = path.join(TEMP_DIR, `bg_processed_${timestamp}.mp4`);
        await new Promise((resolve, reject) => {
            const command = ffmpeg().input(backgroundPath);
            
            if (isAnimatedVideo) {
                command.inputOptions(['-stream_loop', '-1']);
            } else {
                command.inputOptions(['-loop', '1', '-framerate', '25']);
            }

            const vfParams = [
                'scale=1080:1920:force_original_aspect_ratio=increase',
                'crop=1080:1920'
            ];

            // Apply "Ken Burns" pulsing zoom effect only to static images
            if (!isAnimatedVideo) {
                // Pronounced movement: oscillating zoom (zoom in/out)
                // z: oscillates between 1.15 and 1.55 for a dramatic effect
                vfParams.push("zoompan=z='1.35+0.2*sin(in/35)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920");
            }

            command
                .outputOptions([
                    '-pix_fmt yuv420p',
                    `-t ${totalDuration + 1}`,
                    `-vf ${vfParams.join(',')}`
                ])
                .save(bgVidPath)
                .on('end', () => {
                    finalBackgroundPath = bgVidPath;
                    resolve();
                })
                .on('error', reject);
        });
    }

    // Final Assembly with Synchronized Ayah Overlays
    console.log('Final Assembly: Creating individual overlays for each ayah...');
    
    const overlayFiles = [];
    let currentTime = 0;
    const overlayConfigs = [];

    for (let i = 0; i < ayahs.length; i++) {
        const ayah = ayahs[i];
        const duration = durations[i];
        const overlayPath = path.join(TEMP_DIR, `overlay_${timestamp}_${i}.png`);
        
        await createTextOverlay(ayah.text, overlayPath);
        overlayFiles.push(overlayPath);
        
        overlayConfigs.push({
            path: overlayPath,
            start: currentTime,
            end: currentTime + duration
        });
        
        currentTime += duration;
    }

    return new Promise((resolve, reject) => {
        const finalFfmpeg = ffmpeg().input(finalBackgroundPath).input(combinedAudioPath);
        
        // Add all overlay files as inputs
        overlayFiles.forEach(file => finalFfmpeg.input(file));

        // Build complex filter for chaining overlays
        // [0:v] is background, [1:a] is audio
        // [2:v], [3:v]... are overlays
        let filter = '[0:v]scale=1080:1920[base];';
        let lastOutput = 'base';

        overlayConfigs.forEach((config, index) => {
            const inputIndex = index + 2; // +2 because 0 is bg, 1 is audio
            const outputName = `v${index}`;
            filter += `[${inputIndex}:v]scale=1080:1920[ovl${index}];`;
            filter += `[${lastOutput}][ovl${index}]overlay=0:0:enable='between(t,${config.start},${config.end})'${index === overlayConfigs.length - 1 ? '[vout]' : `[${outputName}]`}`;
            if (index < overlayConfigs.length - 1) {
                filter += ';';
            }
            lastOutput = outputName;
        });

        finalFfmpeg
            .complexFilter(filter)
            .outputOptions([
                '-map [vout]',
                '-map 1:a',
                '-c:v libx264',
                '-preset ultrafast',
                '-crf 23',
                '-pix_fmt yuv420p',
                '-shortest'
            ])
            .save(finalOutputPath)
            .on('end', () => {
                console.log('Video generation complete:', finalOutputPath);
                resolve(finalOutputPath);
            })
            .on('error', (err) => {
                console.error('Final FFmpeg Error:', err);
                reject(err);
            });
    });
};

module.exports = {
    validateTools,
    generateReel
};
