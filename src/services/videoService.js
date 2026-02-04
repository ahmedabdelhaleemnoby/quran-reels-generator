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
 * Ensures a compatible Arabic font is available locally
 */
const ensureArabicFont = async () => {
    const fontPath = path.join(TEMP_DIR, 'NotoNaskhArabic-Regular.ttf');
    if (fs.existsSync(fontPath)) return fontPath;

    console.log('Downloading compatible Arabic font (Noto Naskh Arabic)...');
    const url = 'https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoNaskhArabic/NotoNaskhArabic-Regular.ttf';
    try {
        await downloadFile(url, fontPath);
        console.log('Font downloaded successfully');
        return fontPath;
    } catch (error) {
        console.warn('Failed to download Noto font, will use system fallback:', error.message);
        return null;
    }
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
const createTextOverlay = async (text, outputPath, fontName = 'Standard') => {
    const reshaper = require('arabic-persian-reshaper');
    const bidiFactory = require('bidi-js');
    const bidi = bidiFactory();
    
    const width = 1080;
    const height = 1920;
    const img = PImage.make(width, height);
    const ctx = img.getContext('2d');

    // Font selection logic with absolute resilience
    const localFontPath = path.join(TEMP_DIR, 'NotoNaskhArabic-Regular.ttf');
    const fontConfigs = {
        'Standard': '/System/Library/Fonts/Supplemental/Arial.ttf',
        'Modern': localFontPath,
        'Kufi': '/System/Library/Fonts/Supplemental/KufiStandardGK.ttc'
    };
    
    let fontPath = fontConfigs[fontName] || fontConfigs['Standard'];
    let usedFontName = fontName;

    // Loading font with try-catch to prevent "subtables[i]" crash
    let fontLoaded = false;
    const fontSize = 70;

    try {
        if (fs.existsSync(fontPath)) {
            const font = PImage.registerFont(fontPath, usedFontName);
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Font load timeout')), 5000);
                font.load(() => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
            ctx.font = `${fontSize}pt '${usedFontName}'`;
            fontLoaded = true;
        }
    } catch (e) {
        console.warn(`Font load failed for ${fontPath}:`, e.message);
    }

    // Fallback if the requested font failed
    if (!fontLoaded) {
        try {
            console.log('Falling back to Arial...');
            const fallbackPath = '/System/Library/Fonts/Supplemental/Arial.ttf';
            if (fs.existsSync(fallbackPath)) {
                const font = PImage.registerFont(fallbackPath, 'Arial');
                await new Promise((resolve) => font.load(() => resolve()));
                ctx.font = `${fontSize}pt 'Arial'`;
                fontLoaded = true;
            }
        } catch (e) {
            console.error('Arial fallback also failed:', e.message);
        }
    }

    if (!fontLoaded) {
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
            try {
                ctx.fillText(bidiLine, width / 2, y);
            } catch (err) {
                console.warn('Text rendering failed for a line, attempting fallback:', err.message);
                // Last ditch effort: try very basic rendering
                try {
                    ctx.font = `${fontSize}pt sans-serif`;
                    ctx.fillText(bidiLine, width / 2, y);
                } catch (e) {
                    console.error('Final text rendering fallback failed:', e.message);
                }
            }
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
 * Fetches random nature ambience audio
 */
const fetchAmbienceAudio = async (outputPath) => {
    console.log('Fetching random nature ambience audio...');
    // Using verified stable sources or fallbacks
    const ambienceSources = [
        'https://actions.google.com/sounds/v1/nature/rain_on_roof.ogg',
        'https://actions.google.com/sounds/v1/nature/forest_ambience.ogg',
        'https://actions.google.com/sounds/v1/nature/river_sound.ogg'
    ];
    
    // Try each source until one works
    for (const url of ambienceSources) {
        try {
            console.log(`Trying ambience source: ${url}`);
            await downloadFile(url, outputPath);
            console.log('Ambience audio fetched successfully');
            return true;
        } catch (error) {
            console.warn(`Source failed (${url}): ${error.message}`);
        }
    }
    
    console.error('All ambience sources failed.');
    return false;
};

/**
 * Processes the video generation
 */
const generateReel = async (options) => {
    const { reciterId, surahNumber, fromAyah, toAyah, ayahs, backgroundPath: customBackgroundPath, fontName = 'Standard' } = options;
    const timestamp = Date.now();
    const finalOutputPath = path.join(OUTPUT_DIR, `reel_${timestamp}.mp4`);
    
    console.log('Starting generateReel. Resilience mode enabled.');

    // Ensure Arabic font is ready
    await ensureArabicFont();

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
    const recitationAudioPath = path.join(TEMP_DIR, `recitation_${timestamp}.mp3`);
    const ffmpegCombine = ffmpeg();
    audioFiles.forEach(file => ffmpegCombine.input(file));
    
    await new Promise((resolve, reject) => {
        ffmpegCombine
            .on('error', reject)
            .on('end', resolve)
            .mergeToFile(recitationAudioPath, TEMP_DIR);
    });

    // 1b. Prepare Ambience Audio
    const ambiencePath = path.join(TEMP_DIR, `ambience_${timestamp}.mp3`);
    const hasAmbience = await fetchAmbienceAudio(ambiencePath);
    const finalAudioPath = path.join(TEMP_DIR, `final_audio_${timestamp}.mp3`);

    if (hasAmbience) {
        console.log('Mixing recitation with ambience...');
        await new Promise((resolve, reject) => {
            ffmpeg()
                .input(recitationAudioPath)
                .input(ambiencePath)
                .inputOptions(['-stream_loop', '-1']) // Loop ambience
                .complexFilter([
                    '[0:a]volume=1.0[v0]',
                    '[1:a]volume=0.2[v1]', // Subtle ambience
                    '[v0][v1]amix=inputs=2:duration=first[aout]'
                ])
                .outputOptions(['-map [aout]', '-t', totalDuration + 1])
                .save(finalAudioPath)
                .on('end', resolve)
                .on('error', reject);
        });
    } else {
        fs.copyFileSync(recitationAudioPath, finalAudioPath);
    }

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

            const vfParams = isAnimatedVideo ? [
                'scale=1080:1920:force_original_aspect_ratio=increase',
                'crop=1080:1920'
            ] : [
                'scale=1280:2276:force_original_aspect_ratio=increase',
                'crop=1280:2276',
                "zoompan=z='min(1.05+in*0.001,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920"
            ];

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
        
        await createTextOverlay(ayah.text, overlayPath, fontName);
        overlayFiles.push(overlayPath);
        
        overlayConfigs.push({
            path: overlayPath,
            start: currentTime,
            end: currentTime + duration,
            duration: duration
        });
        
        currentTime += duration;
    }

    return new Promise((resolve, reject) => {
        const finalFfmpeg = ffmpeg().input(finalBackgroundPath).input(finalAudioPath);
        
        // Add all overlay files as inputs with looping enabled
        overlayFiles.forEach(file => {
            finalFfmpeg.input(file).inputOptions(['-loop', '1']);
        });

        // Build complex filter for chaining overlays
        // [0:v] is background, [1:a] is audio
        // [2:v], [3:v]... are overlays
        let filter = '[0:v]scale=1080:1920[base];';
        let lastOutput = 'base';

        overlayConfigs.forEach((config, index) => {
            const inputIndex = index + 2; // +2 because 0 is bg, 1 is audio
            const outputName = `v${index}`;
            const dur = config.duration;
            const fadeInDur = Math.min(0.5, dur / 3);
            const fadeOutDur = fadeInDur;
            
            // Apply scale and fade in/out using GLOBAL timestamps (config.start/end)
            // st: start time, d: duration
            filter += `[${inputIndex}:v]scale=1080:1920,fade=t=in:st=${config.start}:d=${fadeInDur}:alpha=1,fade=t=out:st=${config.end - fadeOutDur}:d=${fadeOutDur}:alpha=1[ovl${index}];`;
            
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
