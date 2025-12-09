// index.js - servidor para uploads + planillas (Express + multer + lowdb)
import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { v4 as uuidv4 } from "uuid";
import admin from "firebase-admin";
import { fileURLToPath } from "url";
import { dirname } from "path";

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- FIREBASE ADMIN SETUP ---
const serviceAccount = JSON.parse(
  fs.readFileSync(new URL("./serviceAccountKey.json", import.meta.url), "utf-8")
);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const firestore = admin.firestore();
// --------------------------

const app = express();
const PORT = process.env.PORT || 3001;
const DOMAIN = (process.env.DOMAIN || `http://localhost:${PORT}`).replace(
  /\/$/,
  ""
);
const UPLOADS_DIR = process.env.UPLOADS_DIR || "uploads";
const PLANILLAS_DIR = path.join(UPLOADS_DIR, "planillas");

// ensure directories exist
[UPLOADS_DIR, PLANILLAS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// lowdb setup for simple metadata storage
const dbFile = process.env.DB_FILE || "db.json";
const adapter = new JSONFile(dbFile);
const defaultData = { planillas: [], users: [] };
const db = new Low(adapter, defaultData);

async function initDb() {
  await db.read();
  db.data.users = db.data.users || [];
  await db.write();
}

// middlewares
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
const whitelist = [
  "http://127.0.0.1:5500",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://dea.mabcontrol.ar",
  "https://dea.mabcontrol.ar",
  "https://www.dea.mabcontrol.ar",
];
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || whitelist.includes(origin)) callback(null, true);
    else callback(new Error("No autorizado por CORS"));
  },
};
app.use(cors(corsOptions));
app.use("/uploads", express.static(path.join(__dirname, UPLOADS_DIR)));

// --- AUTH MIDDLEWARE & HELPERS ---
const authMiddleware =
  (roles = []) =>
  async (req, res, next) => {
    const idToken = req.headers.authorization?.split("Bearer ")[1];
    if (!idToken) {
      return res.status(401).json({ error: "No autorizado: Token no provisto" });
    }
    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      req.user = decodedToken;
      if (roles.length > 0 && !roles.some((role) => req.user.role === role)) {
        return res.status(403).json({ error: "No autorizado: Rol insuficiente" });
      }
      next();
    } catch (error) {
      console.error("Error de autenticación:", error);
      return res.status(401).json({ error: "No autorizado: Token inválido" });
    }
  };

async function setUserRole(uid, role) {
  try {
    await admin.auth().setCustomUserClaims(uid, { role });
    console.log(`Rol '${role}' asignado al usuario ${uid}`);
  } catch (error) {
    console.error(`Error asignando rol a ${uid}:`, error);
    throw new Error("Error al asignar rol");
  }
}
// ---------------------------------

// --- USER CRUD ROUTES ---

// ##########################################################################
// #  ADVERTENCIA DE SEGURIDAD: RUTAS DE USUARIO ABIERTAS                    #
// #  Las siguientes rutas CRUD para usuarios están desprotegidas           #
// #  temporalmente para facilitar la configuración inicial. CUALQUIERA     #
// #  puede crear, ver, editar y eliminar usuarios (incluyendo admins).     #
// #  ES CRÍTICO volver a agregar el `authMiddleware` a estas rutas         #
// #  antes de pasar a producción.                                          #
// ##########################################################################

// Create User (TEMPORARILY PUBLIC)
app.post("/users", async (req, res) => {
  const { email, password, displayName, role } = req.body;
  if (!email || !password || !role) {
    return res
      .status(400)
      .json({ error: "Email, password y role son requeridos" });
  }

  try {
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName,
    });

    await setUserRole(userRecord.uid, role);

    const newUser = {
      uid: userRecord.uid,
      email: userRecord.email,
      displayName: userRecord.displayName,
      role: role,
    };

    db.data.users.push(newUser);
    await db.write();

    res.status(201).json(newUser);
  } catch (error) {
    console.error("Error creando usuario:", error);
    if (error.code === 'auth/configuration-not-found') {
        return res.status(500).json({ 
            error: "Firebase Authentication is not configured.",
            detail: "Please go to your Firebase Console, enable Authentication, and add 'Email/Password' as a sign-in method."
        });
    }
    res.status(500).json({ error: "Error al crear usuario" });
  }
});

// Get all users (TEMPORARILY PUBLIC)
app.get("/users", (req, res) => {
  res.json(db.data.users);
});

// Get user by ID (TEMPORARILY PUBLIC)
app.get("/users/:id", async (req, res) => {
  const { id } = req.params;
  const user = db.data.users.find((u) => u.uid === id);
  if (user) {
    res.json(user);
  } else {
    res.status(404).json({ error: "Usuario no encontrado" });
  }
});

// Update user (TEMPORARILY PUBLIC)
app.put("/users/:id", async (req, res) => {
  const { id } = req.params;
  const { displayName, role } = req.body;

  try {
    const userIndex = db.data.users.findIndex((u) => u.uid === id);
    if (userIndex === -1) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const user = db.data.users[userIndex];
    const updateData = {};
    if (displayName) {
      updateData.displayName = displayName;
      user.displayName = displayName;
    }

    await admin.auth().updateUser(id, updateData);

    if (role) {
      await setUserRole(id, role);
      user.role = role;
    }
    
    await db.write();

    res.json(user);
  } catch (error) {
    console.error(`Error actualizando usuario ${id}:`, error);
    res.status(500).json({ error: "Error al actualizar usuario" });
  }
});

// Delete user (TEMPORARILY PUBLIC)
app.delete("/users/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await admin.auth().deleteUser(id);

    const userIndex = db.data.users.findIndex((u) => u.uid === id);
    if (userIndex > -1) {
      db.data.users.splice(userIndex, 1);
      await db.write();
    }

    res.status(200).json({ ok: true, message: "Usuario eliminado" });
  } catch (error) {
    console.error(`Error eliminando usuario ${id}:`, error);
    res.status(500).json({ error: "Error al eliminar usuario" });
  }
});


// ------------------------


// Manejo de errores
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
});

// multer storage (files go to uploads/)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR + "/"),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ["image/png", "image/jpeg", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Tipo de archivo no permitido"), false);
    }
    cb(null, true);
  },
});

// --- Image upload endpoint (compatible con tu front)
app.post("/upload", upload.single("image"), (req, res) => {
  if (!req.file)
    return res.status(400).json({ error: "No se subió ningún archivo." });
  const fileUrl = `${DOMAIN}/uploads/${req.file.filename}`;
  return res.json({ imageUrl: fileUrl, filename: req.file.filename });
});

// --- Delete single image endpoint
app.delete("/uploads/:filename", (req, res) => {
  const { filename } = req.params;
  // Security check: prevent directory traversal
  if (
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\")
  ) {
    return res.status(400).json({ error: "Nombre de archivo inválido" });
  }

  const filePath = path.join(__dirname, UPLOADS_DIR, filename);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Imagen eliminada manualmente: ${filename}`);
      return res.json({ ok: true });
    } else {
      return res.status(404).json({ error: "Archivo no encontrado" });
    }
  } catch (err) {
    console.error(`Error borrando ${filename}:`, err);
    return res.status(500).json({ error: "Error al eliminar archivo" });
  }
});

// --- Create planilla
// Accepts either application/json with body { data: {...}, images: [...] }
// or multipart/form-data with field `planilla` (JSON string) and `images[]` files
app.post("/planillas", upload.array("images"), async (req, res) => {
  try {
    // await initDb(); // <- ELIMINADO
    let planillaData = null;

    if (req.is("application/json") || req.body.data) {
      // JSON body: { data: {...}, images: [url,...] }
      planillaData = req.body.data || req.body;
    } else if (req.body.planilla) {
      // multipart: text field 'planilla' with JSON string
      try {
        planillaData = JSON.parse(req.body.planilla);
      } catch (e) {
        return res
          .status(400)
          .json({ error: "Campo planilla no es JSON válido" });
      }
    } else {
      // fallback: take body as is
      planillaData = req.body;
    }

    const id = uuidv4();
    const createdAt = new Date().toISOString();
    const images = [];

    if (req.files && req.files.length) {
      for (const f of req.files) {
        const publicUrl = `${DOMAIN}/uploads/${f.filename}`;
        images.push({
          filename: f.filename,
          url: publicUrl,
          originalname: f.originalname,
        });
      }
    }

    // Optionally store a copy of the planilla as a file (JSON) for download
    const planillaFilename = `planilla_${Date.now()}_${id}.json`;
    const planillaPath = path.join(PLANILLAS_DIR, planillaFilename);
    fs.writeFileSync(
      planillaPath,
      JSON.stringify({ meta: planillaData, images }, null, 2),
      "utf8"
    );

    const record = {
      id,
      filename: planillaFilename,
      filePath: `/uploads/planillas/${planillaFilename}`,
      createdAt,
      updatedAt: createdAt,
      syncStatus: "pending", // pending|synced|error
      remoteId: null,
      images,
      meta: planillaData,
    };

    db.data.planillas.push(record);
    await db.write();

    // --- GUARDAR EN FIRESTORE ---
    try {
      console.log("Guardando en Firestore...");
      const firestoreRef = await firestore.collection("planillas").add(record);
      console.log("Documento guardado en Firestore con ID: ", firestoreRef.id);
      // Opcional: actualizar el registro local con el ID de firestore
      record.remoteId = firestoreRef.id;
      record.syncStatus = "synced";
      await db.write();
    } catch (firestoreError) {
      console.error("Error guardando en Firestore:", firestoreError);
      // La planilla ya está en lowdb, se puede re-intentar la sincronización después
    }
    // ----------------------------

    return res.status(201).json({ ok: true, planilla: record });
  } catch (err) {
    console.error("Error POST /planillas:", err);
    return res
      .status(500)
      .json({ error: "Error interno", detalle: err.message });
  }
});
app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// --- List planillas
app.get("/planillas", async (req, res) => {
  // await initDb(); // <- ELIMINADO
  return res.json({ planillas: db.data.planillas });
});

// --- Get single planilla metadata (and link to file)
app.get("/planillas/:id", async (req, res) => {
  // await initDb(); // <- ELIMINADO
  const rec = db.data.planillas.find((p) => p.id === req.params.id);
  if (!rec) return res.status(404).json({ error: "No encontrada" });
  return res.json({ planilla: rec });
});

// --- Mark as synced (client calls this after successful remote save)
app.post("/planillas/:id/sync", async (req, res) => {
  const { remoteId } = req.body || {};
  // await initDb(); // <- ELIMINADO
  const rec = db.data.planillas.find((p) => p.id === req.params.id);
  if (!rec) return res.status(404).json({ error: "No encontrada" });
  rec.syncStatus = "synced";
  rec.remoteId = remoteId || rec.remoteId || null;
  rec.updatedAt = new Date().toISOString();
  await db.write();
  return res.json({ ok: true, planilla: rec });
});

// --- Delete planilla (metadata + stored JSON + optionally images)
app.delete("/planillas/:id", async (req, res) => {
  try {
    const idx = db.data.planillas.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "No encontrada" });
    const rec = db.data.planillas[idx];

    // remove stored planilla file
    try {
      const fullPath = path.join(__dirname, rec.filePath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    } catch (e) {
      console.warn("No pude borrar archivo planilla", e.message);
    }

    // Delete uploaded images associated with this planilla
    console.log(
      `Intentando borrar ${
        rec.images ? rec.images.length : 0
      } imágenes asociadas...`
    );
    for (const img of rec.images || []) {
      try {
        if (!img.filename) {
          console.warn("Imagen sin filename, saltando:", img);
          continue;
        }
        const imgPath = path.join(__dirname, UPLOADS_DIR, img.filename);
        console.log(`Buscando imagen en: ${imgPath}`);

        if (fs.existsSync(imgPath)) {
          fs.unlinkSync(imgPath);
          console.log(`✅ Imagen eliminada: ${img.filename}`);
        } else {
          console.log(`⚠️ Imagen no encontrada en disco: ${imgPath}`);
        }
      } catch (e) {
        console.warn(`❌ No pude borrar imagen ${img.filename}:`, e.message);
      }
    }

    // Remove from lowdb
    db.data.planillas.splice(idx, 1);
    await db.write();

    // --- DELETE FROM FIRESTORE ---
    if (rec.remoteId) {
      try {
        console.log("Eliminando de Firestore...");
        await firestore.collection("planillas").doc(rec.remoteId).delete();
        console.log("Documento eliminado de Firestore con ID:", rec.remoteId);
      } catch (firestoreError) {
        console.error("Error eliminando de Firestore:", firestoreError);
        // Continue anyway - the local DB was already updated
      }
    }
    // ----------------------------

    return res.json({ ok: true });
  } catch (err) {
    console.error("Error DELETE /planillas/:id:", err);
    return res
      .status(500)
      .json({ error: "Error interno", detalle: err.message });
  }
});
// --- Update planilla (actualiza un registro)
app.put("/planillas/:id", upload.array("images"), async (req, res) => {
  try {
    const id = req.params.id;

    // Parse planilla data from form
    let planillaData = null;
    if (req.body.planilla) {
      try {
        planillaData = JSON.parse(req.body.planilla);
      } catch (e) {
        return res
          .status(400)
          .json({ error: "Campo planilla no es JSON válido" });
      }
    } else {
      return res.status(400).json({ error: "Campo planilla es requerido" });
    }

    // 1. Find existing record img
    const rec = db.data.planillas.find((p) => p.id === id);
    if (!rec) return res.status(404).json({ error: "Planilla no encontrada" });

    // 2. Process new uploaded images
    const newImages = [];
    if (req.files && req.files.length) {
      for (const f of req.files) {
        const publicUrl = `${DOMAIN}/uploads/${f.filename}`;
        newImages.push({
          filename: f.filename,
          url: publicUrl,
          originalname: f.originalname,
        });
      }
    }

    // 3. Combine images: keep existing ones from planillaData + add new uploads
    const listaFinalImagenes = [...(planillaData.images || []), ...newImages];

    // DELETE OLD JSON FILE if exists
    if (rec.filename) {
      try {
        const oldPath = path.join(PLANILLAS_DIR, rec.filename);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      } catch (e) {
        console.warn("No pude borrar planilla anterior", e.message);
      }
    }

    // 4. Update the planilla JSON file
    const planillaFilename = `planilla_${Date.now()}_${id}.json`;
    const planillaPath = path.join(PLANILLAS_DIR, planillaFilename);
    fs.writeFileSync(
      planillaPath,
      JSON.stringify(
        { meta: planillaData, images: listaFinalImagenes },
        null,
        2
      ),
      "utf8"
    );

    // 5. Update record in lowdb
    rec.filename = planillaFilename;
    rec.filePath = `/uploads/planillas/${planillaFilename}`;
    rec.updatedAt = new Date().toISOString();
    rec.images = listaFinalImagenes;
    rec.meta = planillaData;

    await db.write();

    // 6. Update in Firestore if remoteId exists
    if (rec.remoteId) {
      try {
        console.log("Actualizando en Firestore...");
        await firestore.collection("planillas").doc(rec.remoteId).update({
          filename: rec.filename,
          filePath: rec.filePath,
          updatedAt: rec.updatedAt,
          images: listaFinalImagenes,
          meta: planillaData,
        });
        console.log("Documento actualizado en Firestore con ID:", rec.remoteId);
      } catch (firestoreError) {
        console.error("Error actualizando en Firestore:", firestoreError);
        // Continue anyway - the local DB was updated
      }
    }

    return res.json({ ok: true, planilla: rec });
  } catch (err) {
    console.error("Error PUT /planillas/:id:", err);
    return res
      .status(500)
      .json({ error: "Error interno", detalle: err.message });
  }
});
// --- Mapa estático (igual que tu versión)
const GOOGLE_KEY = process.env.GOOGLE_MAPS_KEY;

app.get("/mapa-static", async (req, res) => {
  try {
    const { lat, lon, zoom = 16, size = "400x200" } = req.query;
    if (!lat || !lon)
      return res.status(400).json({ error: "Parámetros lat y lon requeridos" });
    if (!GOOGLE_KEY)
      return res
        .status(500)
        .json({ error: "GOOGLE_MAPS_KEY no configurada en el servidor" });

    const latN = Number(lat);
    const lonN = Number(lon);
    if (Number.isNaN(latN) || Number.isNaN(lonN))
      return res.status(400).json({ error: "lat o lon inválidos" });

    const url = `https://maps.googleapis.com/maps/api/staticmap?center=${latN},${lonN}&zoom=${zoom}&size=${size}&markers=color:red%7C${latN},${lonN}&key=${GOOGLE_KEY}`;
    const response = await (globalThis.appFetchFn || globalThis.fetch)(url);
    if (!response.ok)
      return res
        .status(502)
        .json({ error: "Error al obtener imagen", status: response.status });

    const buffer = Buffer.from(await response.arrayBuffer());
    const fileName = `mapa_${Date.now()}.png`;
    const filePath = path.join(__dirname, UPLOADS_DIR, fileName);
    fs.writeFileSync(filePath, buffer);

    const publicUrl = `${DOMAIN}/uploads/${fileName}`;
    return res.json({ imageUrl: publicUrl });
  } catch (err) {
    console.error("Error /mapa-static:", err);
    return res
      .status(500)
      .json({ error: "Error interno", detalle: err.message });
  }
});

// root test
app.get("/", (req, res) =>
  res.send("Servidor de subidas + planillas funcionando...")
);

// start server
(async function start() {
  await initDb();

  // Initialize fetch if needed
  let fetchFn = globalThis.fetch;
  if (!fetchFn) {
    try {
      const undici = await import("undici");
      fetchFn = undici.fetch;
    } catch (e) {
      console.error(
        'fetch no disponible. Instalá Node 18+ o "npm i undici" en el servidor.'
      );
    }
  }

  // Store fetchFn globally for use in /mapa-static route
  globalThis.appFetchFn = fetchFn;

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor escuchando en http://0.0.0.0:${PORT}`);
  });
})();
