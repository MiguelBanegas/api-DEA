// index.js - versión corregida
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;
const DOMAIN = process.env.DOMAIN || 'https://dea.mabcontrol.ar';
const UPLOADS_DIR = process.env.UPLOADS_DIR || 'uploads';

// Crear uploads si no existe
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Middlewares
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
const whitelist = [
  'http://127.0.0.1:5500',
  'http://dea.mabcontrol.ar',
  'https://dea.mabcontrol.ar',
  'https://www.dea.mabcontrol.ar'
];
const corsOptions = {
  origin: function (origin, callback) {
    // allow requests with no origin (like curl, mobile apps, server-to-server)
    if (!origin || whitelist.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('No autorizado por CORS'));
    }
  }
};
app.use(cors(corsOptions));

// Servir archivos estáticos uploads
app.use('/uploads', express.static(path.join(__dirname, UPLOADS_DIR)));

// multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR + '/'),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Ruta de subida de archivos desde front (already used)
app.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo.' });
  const fileUrl = `${DOMAIN.replace(/\/$/, '')}/uploads/${req.file.filename}`;
  return res.json({ imageUrl: fileUrl });
});

// --- Nota: la ruta /protocolo a continuación usa `db`.
// Si querés usarla, inicializá firebase-admin y definí `db`.
// De lo contrario, borrala o adaptala.
app.get('/protocolo', async (req, res) => {
  // EJEMPLO: esto fallará si no inicializaste `db`
  try {
    return res.status(501).json({ error: 'No implementado en este servidor. Inicializá firebase-admin o llamá a Firestore desde el front.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error del servidor', detalle: err.message });
  }
});

// --- /mapa-static: descarga la imagen de Google *desde el servidor* y la guarda en /uploads
// Se recomienda no exponer la API Key en el front; ponerla en .env
const GOOGLE_KEY = process.env.GOOGLE_MAPS_KEY;
if (!GOOGLE_KEY) {
  console.warn('WARNING: GOOGLE_MAPS_KEY no definido en .env. /mapa-static no funcionará sin key.');
}

// fetch fallback (Node 18+ tiene global fetch; si no, usamos undici)
let fetchFn = globalThis.fetch;
if (!fetchFn) {
  try {
    // undici debe estar instalado en el servidor: npm i undici
    fetchFn = require('undici').fetch;
  } catch (e) {
    console.error('fetch no disponible. Instalá Node 18+ o "npm i undici" en el servidor.');
    process.exit(1);
  }
}

app.get('/mapa-static', async (req, res) => {
  try {
    const { lat, lon, zoom = 16, size = '400x200' } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'Parámetros lat y lon requeridos' });

    if (!GOOGLE_KEY) return res.status(500).json({ error: 'GOOGLE_MAPS_KEY no configurada en el servidor' });

    // Sanitize / small validation
    const latN = Number(lat);
    const lonN = Number(lon);
    if (Number.isNaN(latN) || Number.isNaN(lonN)) return res.status(400).json({ error: 'lat o lon inválidos' });

    const url = `https://maps.googleapis.com/maps/api/staticmap?center=${latN},${lonN}&zoom=${zoom}&size=${size}&markers=color:red%7C${latN},${lonN}&key=${GOOGLE_KEY}`;

    const response = await fetchFn(url);
    if (!response.ok) {
      console.error('Google Static Maps respondió:', response.status, response.statusText);
      return res.status(502).json({ error: 'Error al obtener la imagen desde Google Maps', status: response.status });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const fileName = `mapa_${Date.now()}.png`;
    const filePath = path.join(__dirname, UPLOADS_DIR, fileName);
    fs.writeFileSync(filePath, buffer);

    const publicUrl = `${DOMAIN.replace(/\/$/, '')}/uploads/${fileName}`;
    return res.json({ imageUrl: publicUrl });

  } catch (err) {
    console.error('Error en /mapa-static:', err);
    return res.status(500).json({ error: 'Error interno', detalle: err.message });
  }
});

// test
app.get('/', (req, res) => res.send('Servidor de subidas funcionando...'));

// arrancar servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor escuchando en http://0.0.0.0:${PORT}`);
});

