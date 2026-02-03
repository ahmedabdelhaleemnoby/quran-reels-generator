const express = require('express');
const cors = require('cors');
const path = require('path');
const videoController = require('./src/controllers/videoController');

const app = express();
const PORT = process.env.PORT || 3005;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/output', express.static('output'));

// Routes
app.get('/api/initial-data', videoController.getInitialData);
app.post('/api/generate-video', videoController.generateVideo);

// Health check for tools
const { validateTools } = require('./src/services/videoService');

app.listen(PORT, async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    const toolsOk = await validateTools();
    if (!toolsOk) {
        console.warn('WARNING: FFmpeg or ImageMagick not found. Video generation will fail.');
    }
});
