import "dotenv/config";
import admin from "firebase-admin";
import fs from "fs";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { fileURLToPath } from "url";
import { dirname } from "path";

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- CONFIGURATION ---
// Cambia estos valores para tu usuario administrador
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "aVeryStrongPassword123"; // Elige una contraseña fuerte
// ---------------------

async function createAdminUser() {
  console.log("Iniciando script para crear usuario admin...");

  // 1. Initialize Firebase Admin
  try {
    const serviceAccount = JSON.parse(
      fs.readFileSync(new URL("./serviceAccountKey.json", import.meta.url), "utf-8")
    );
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("Firebase Admin SDK inicializado.");
  } catch (error) {
    console.error(
      "Error al inicializar Firebase Admin. Asegúrate de que tu `serviceAccountKey.json` es correcto.",
      error
    );
    process.exit(1);
  }

  // 2. Initialize LowDB
  const dbFile = process.env.DB_FILE || "db.json";
  const adapter = new JSONFile(dbFile);
  const db = new Low(adapter, { planillas: [], users: [] });
  await db.read();
  db.data.users = db.data.users || [];
  console.log("Base de datos local (lowdb) cargada.");

  // 3. Check if user already exists in Firebase
  let userRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(ADMIN_EMAIL);
    console.log(`El usuario con email ${ADMIN_EMAIL} ya existe en Firebase Auth.`);
  } catch (error) {
    if (error.code === "auth/user-not-found") {
      // 4. Create user in Firebase Authentication
      console.log(`Creando usuario en Firebase Auth con email: ${ADMIN_EMAIL}`);
      try {
        userRecord = await admin.auth().createUser({
          email: ADMIN_EMAIL,
          password: ADMIN_PASSWORD,
          displayName: "Administrador",
        });
        console.log(`Usuario creado en Firebase Auth con UID: ${userRecord.uid}`);
      } catch (createError) {
        console.error(
          "Error al crear el usuario en Firebase Auth:",
          createError
        );
        process.exit(1);
      }
    } else {
      console.error("Error inesperado al buscar usuario en Firebase:", error);
      process.exit(1);
    }
  }

  // 5. Set custom claim for 'admin' role
  console.log(`Asignando rol 'admin' al usuario ${userRecord.uid}...`);
  try {
    await admin.auth().setCustomUserClaims(userRecord.uid, { role: "admin" });
    console.log("Rol de administrador asignado correctamente.");
  } catch (claimError) {
    console.error("Error al asignar el rol de administrador:", claimError);
    process.exit(1);
  }

  // 6. Add or update user in local DB
  const existingUserIndex = db.data.users.findIndex(
    (u) => u.uid === userRecord.uid
  );
  const adminData = {
    uid: userRecord.uid,
    email: userRecord.email,
    displayName: userRecord.displayName || "Administrador",
    role: "admin",
  };

  if (existingUserIndex !== -1) {
    console.log("El usuario ya existe en la base de datos local. Actualizando...");
    db.data.users[existingUserIndex] = adminData;
  } else {
    console.log("Agregando usuario a la base de datos local...");
    db.data.users.push(adminData);
  }

  await db.write();
  console.log("Base de datos local actualizada.");

  console.log("\n¡Éxito! El usuario administrador ha sido creado y configurado.");
  console.log(`- Email: ${ADMIN_EMAIL}`);
  console.log(`- UID: ${userRecord.uid}`);
  console.log("- Rol: admin");
  console.log("\nIMPORTANTE: Elimina este script (create-admin.js) por seguridad.");

  process.exit(0);
}

createAdminUser();
