const axios = require('axios');

const QURAN_API_BASE = 'https://api.alquran.cloud/v1';
const EVERY_AYAH_BASE = 'https://www.everyayah.com/data';

const reciters = [
    { id: 'Abdul_Basit_Murattal_64kbps', name: 'عبد الباسط عبد الصمد (مرتل)', name_en: 'Abdul Basit (Murattal)' },
    { id: 'Abdurrahmaan_As-Sudais_192kbps', name: 'عبد الرحمن السديس', name_en: 'Abdurrahmaan As-Sudais' },
    { id: 'Alafasy_128kbps', name: 'مشاري العفاسي', name_en: 'Mishary Rashid Alafasy' },
    { id: 'Ghamadi_40kbps', name: 'سعد الغامدي', name_en: 'Saad Al-Ghamdi' },
    { id: 'Husary_64kbps', name: 'محمود خليل الحصري', name_en: 'Mahmoud Khalil Al-Husary' },
    { id: 'Minshawi_Murattal_128kbps', name: 'محمد صديق المنشاوي (مرتل)', name_en: 'Mohamed Siddiq Al-Minshawi' },
    { id: 'MaherAlMuaiqly128kbps', name: 'ماهر المعيقلي', name_en: 'Maher Al-Muaiqly' }
];

const getSurahs = async () => {
    try {
        const response = await axios.get(`${QURAN_API_BASE}/surah`, { timeout: 15000 });
        return response.data.data;
    } catch (error) {
        console.error('Error fetching surahs:', error);
        throw error;
    }
};

const getAyahs = async (surahNumber, fromAyah, toAyah) => {
    try {
        const response = await axios.get(`${QURAN_API_BASE}/surah/${surahNumber}`, { timeout: 15000 });
        const allAyahs = response.data.data.ayahs;
        return allAyahs.filter(ayah => ayah.numberInSurah >= fromAyah && ayah.numberInSurah <= toAyah);
    } catch (error) {
        console.error('Error fetching ayahs:', error);
        throw error;
    }
};

const getAudioUrl = (reciterId, surahNumber, ayahNumber) => {
    const s = String(surahNumber).padStart(3, '0');
    const a = String(ayahNumber).padStart(3, '0');
    return `${EVERY_AYAH_BASE}/${reciterId}/${s}${a}.mp3`;
};

module.exports = {
    reciters,
    getSurahs,
    getAyahs,
    getAudioUrl
};
