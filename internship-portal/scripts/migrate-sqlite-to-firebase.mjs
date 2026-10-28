import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read .env manually
const envPath = path.join(__dirname, '..', '.env');
const env = {};
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [k, ...v] = trimmed.split('=');
    if (k && v) env[k.trim()] = v.join('=').trim();
  }
}

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID,
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId || firebaseConfig.apiKey.includes('your-api-key')) {
  console.error('\n❌ Error: Valid Firebase credentials not found in .env');
  console.error('Please configure your VITE_FIREBASE_* keys in internship-portal/.env before running this script.\n');
  process.exit(1);
}

console.log(`\n🚀 Initializing Firebase migration for project: ${firebaseConfig.projectId}...`);
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

const dbPath = path.join(__dirname, '..', 'database', 'college_portal.sqlite');
if (!fs.existsSync(dbPath)) {
  console.error('❌ SQLite database file not found at:', dbPath);
  process.exit(1);
}

const sqlite = new DatabaseSync(dbPath);

async function migrate() {
  console.log('\n--- 1. Migrating User Credentials ---');
  const users = sqlite.prepare('SELECT * FROM user_credentials').all();
  for (const u of users) {
    const docId = u.id || (u.identifier === 'admin' ? 'admin-root-01' : `user-${u.identifier}`);
    await setDoc(doc(db, 'user_credentials', docId), {
      identifier: u.identifier,
      roll_number: u.roll_number || '',
      name: u.name,
      email: u.email,
      password: u.password,
      role: u.role || 'student',
      created_at: u.created_at || new Date().toISOString(),
    });
    console.log(` ✅ Migrated user credential: ${u.name} (${u.identifier})`);
  }

  console.log('\n--- 2. Migrating Job Postings ---');
  const jobs = sqlite.prepare('SELECT * FROM job_data').all();
  for (const j of jobs) {
    await setDoc(doc(db, 'job_data', j.id), {
      title: j.title,
      department_or_company: j.department_or_company,
      description: j.description,
      skills: JSON.parse(j.skills || '[]'),
      stipend: j.stipend,
      duration: j.duration,
      work_mode: j.work_mode,
      domain: j.domain,
      eligibility: j.eligibility,
      posted_date: j.posted_date,
    });
    console.log(` ✅ Migrated job posting: ${j.title}`);
  }

  console.log('\n--- 3. Migrating Student Applications & Resumes ---');
  const apps = sqlite.prepare('SELECT * FROM user_data').all();
  const uploadsDir = path.join(__dirname, '..', 'database', 'uploads', 'resumes');

  for (const a of apps) {
    let resumeUrl = '';
    if (a.resume_filename) {
      const localResumePath = path.join(uploadsDir, a.resume_filename);
      if (fs.existsSync(localResumePath)) {
        try {
          const fileData = fs.readFileSync(localResumePath);
          const safeName = `${(a.roll_number || 'student').replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.pdf`;
          const storageRef = ref(storage, `resumes/${safeName}`);
          await uploadBytes(storageRef, fileData, { contentType: 'application/pdf' });
          resumeUrl = await getDownloadURL(storageRef);
          console.log(` 📄 Uploaded resume file to Cloud Storage: ${safeName}`);
        } catch (uploadErr) {
          console.warn(` ℹ️ Cloud Storage not active. Saving resume as Firestore Base64 Data URI (Free tier without Blaze)...`);
          const fileData = fs.readFileSync(localResumePath);
          resumeUrl = `data:application/pdf;base64,${fileData.toString('base64')}`;
          console.log(` 📄 Converted resume to embedded Data URI successfully!`);
        }
      }
    }

    await setDoc(doc(db, 'user_data', a.id), {
      roll_number: a.roll_number,
      name: a.name,
      email: a.email,
      phone: a.phone,
      college_name: a.college_name,
      degree: a.degree,
      department: a.department,
      academic_year: a.academic_year,
      graduation_year: a.graduation_year,
      cgpa: a.cgpa || '',
      skills: JSON.parse(a.skills || '[]'),
      projects: a.projects || '',
      experience: a.experience || '',
      preferred_domain: a.preferred_domain || '',
      availability: a.availability || '',
      github: a.github || '',
      linkedin: a.linkedin || '',
      portfolio: a.portfolio || '',
      resume_filename: a.resume_filename || '',
      resume_url: resumeUrl,
      internship_id: a.internship_id || '',
      internship_title: a.internship_title || '',
      submitted_at: a.submitted_at || new Date().toISOString(),
    });
    console.log(` ✅ Migrated candidate application: ${a.name} (${a.roll_number})`);
  }

  console.log('\n✨ Database migration to Firebase completed successfully!\n');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('\n❌ Migration failed:', err);
  process.exit(1);
});
