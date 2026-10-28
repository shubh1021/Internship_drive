import type { Internship, SubmittedApplication, UserSession, CandidateProfile } from '../types';
import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  addDoc,
  deleteDoc,
  query,
  where,
  or,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage, isFirebaseConfigured } from '../lib/firebase';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

// ============================================
// 1. User Credentials Authentication
// ============================================
export const authApi = {
  async login(identifier: string, pass: string): Promise<{ success: boolean; user?: UserSession; error?: string }> {
    const cleanId = identifier.trim().toLowerCase();
    const cleanPass = pass;

    // --- Firebase Firestore Path ---
    if (isFirebaseConfigured && db) {
      try {
        // Auto-seed admin user if admin logs in and doc does not exist yet
        if (cleanId === 'admin') {
          const adminDocRef = doc(db, 'user_credentials', 'admin-root-01');
          const adminSnap = await getDoc(adminDocRef);
          if (!adminSnap.exists()) {
            await setDoc(adminDocRef, {
              identifier: 'admin',
              roll_number: 'ADMIN',
              name: 'Placement Administrator',
              email: 'placement-cell@college.edu',
              password: 'admin@college2026',
              role: 'admin',
              created_at: new Date().toISOString(),
            });
          }
        }

        // Query user credentials collection
        const credsRef = collection(db, 'user_credentials');
        const q = query(
          credsRef,
          or(
            where('identifier', '==', cleanId),
            where('roll_number', '==', cleanId.toUpperCase()),
            where('email', '==', cleanId)
          )
        );
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
          return {
            success: false,
            error: 'No account found with this Roll Number/Email. Please register first.',
          };
        }

        const userDoc = querySnapshot.docs[0].data();
        if (userDoc.password !== cleanPass) {
          return { success: false, error: 'Incorrect password. Please try again.' };
        }

        return {
          success: true,
          user: {
            role: userDoc.role as 'student' | 'admin',
            name: userDoc.name,
            email: userDoc.email,
            rollNumber: userDoc.roll_number,
          },
        };
      } catch (err: any) {
        console.error('[Firebase Auth Login Error]', err);
        return { success: false, error: err.message || 'Firebase login failed.' };
      }
    }

    // --- Supabase Path ---
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('user_credentials')
          .select('*')
          .or(`identifier.ilike.${cleanId},roll_number.ilike.${cleanId},email.ilike.${cleanId}`)
          .maybeSingle();

        if (error) {
          console.error('[Supabase Auth Error]', error);
          return { success: false, error: 'Database connection error.' };
        }

        if (!data) {
          return {
            success: false,
            error: 'No account found with this Roll Number/Email. Please register first.',
          };
        }

        if (data.password !== cleanPass) {
          return { success: false, error: 'Incorrect password. Please try again.' };
        }

        return {
          success: true,
          user: {
            role: data.role as 'student' | 'admin',
            name: data.name,
            email: data.email,
            rollNumber: data.roll_number,
          },
        };
      } catch (err: any) {
        return { success: false, error: err.message || 'Supabase authentication failed.' };
      }
    }

    // --- Local SQL Server Fallback ---
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password: pass }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Login failed.' };
      }
      return { success: true, user: data.user };
    } catch {
      return { success: false, error: 'Cannot connect to SQL backend server.' };
    }
  },

  async register(
    rollNumber: string,
    name: string,
    email: string,
    pass: string
  ): Promise<{ success: boolean; user?: UserSession; error?: string }> {
    const cleanRoll = rollNumber.trim().toUpperCase();
    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();

    if (cleanRoll.toLowerCase() === 'admin' || cleanEmail === 'admin') {
      return { success: false, error: 'This identifier is reserved.' };
    }

    // --- Firebase Firestore Path ---
    if (isFirebaseConfigured && db) {
      try {
        const credsRef = collection(db, 'user_credentials');
        const q = query(
          credsRef,
          or(
            where('identifier', '==', cleanRoll.toLowerCase()),
            where('roll_number', '==', cleanRoll),
            where('email', '==', cleanEmail)
          )
        );
        const existing = await getDocs(q);

        if (!existing.empty) {
          return {
            success: false,
            error: 'An account with this Roll Number or Email already exists. Please log in.',
          };
        }

        const newDocRef = doc(credsRef);
        await setDoc(newDocRef, {
          id: newDocRef.id,
          identifier: cleanRoll.toLowerCase(),
          roll_number: cleanRoll,
          name: cleanName,
          email: cleanEmail,
          password: pass,
          role: 'student',
          created_at: new Date().toISOString(),
        });

        return {
          success: true,
          user: {
            role: 'student',
            name: cleanName,
            email: cleanEmail,
            rollNumber: cleanRoll,
          },
        };
      } catch (err: any) {
        console.error('[Firebase Register Error]', err);
        return { success: false, error: err.message || 'Firebase registration failed.' };
      }
    }

    // --- Supabase Path ---
    if (isSupabaseConfigured) {
      try {
        const { data: existing } = await supabase
          .from('user_credentials')
          .select('id')
          .or(`identifier.ilike.${cleanRoll.toLowerCase()},email.ilike.${cleanEmail}`)
          .maybeSingle();

        if (existing) {
          return {
            success: false,
            error: 'An account with this Roll Number or Email already exists. Please log in.',
          };
        }

        const { data, error } = await supabase
          .from('user_credentials')
          .insert([
            {
              identifier: cleanRoll.toLowerCase(),
              roll_number: cleanRoll,
              name: cleanName,
              email: cleanEmail,
              password: pass,
              role: 'student',
            },
          ])
          .select()
          .single();

        if (error) {
          console.error('[Supabase Register Error]', error);
          return { success: false, error: error.message || 'Failed to save credentials in Supabase.' };
        }

        return {
          success: true,
          user: {
            role: 'student',
            name: data.name,
            email: data.email,
            rollNumber: data.roll_number,
          },
        };
      } catch (err: any) {
        return { success: false, error: err.message || 'Supabase registration failed.' };
      }
    }

    // --- Local SQL Server Fallback ---
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rollNumber, name, email, password: pass }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Registration failed.' };
      }
      return { success: true, user: data.user };
    } catch {
      return { success: false, error: 'Cannot connect to SQL backend server.' };
    }
  },
};

// ============================================
// 2. Job Data Management
// ============================================
export const jobsApi = {
  async getAll(): Promise<Internship[]> {
    // --- Firebase Firestore Path ---
    if (isFirebaseConfigured && db) {
      try {
        const jobsSnapshot = await getDocs(collection(db, 'job_data'));
        const list: Internship[] = [];
        jobsSnapshot.forEach((d) => {
          const row = d.data();
          list.push({
            id: d.id,
            title: row.title || '',
            departmentOrCompany: row.department_or_company || row.departmentOrCompany || '',
            description: row.description || '',
            skills: Array.isArray(row.skills) ? row.skills : JSON.parse(row.skills || '[]'),
            stipend: row.stipend || '',
            duration: row.duration || '',
            workMode: row.work_mode || row.workMode || 'On-Campus',
            domain: row.domain || '',
            eligibility: row.eligibility || '',
            postedDate: row.posted_date || row.postedDate || new Date().toISOString().split('T')[0],
          });
        });
        // Sort descending by postedDate
        return list.sort((a, b) => b.postedDate.localeCompare(a.postedDate));
      } catch (err) {
        console.error('[Firebase Fetch Jobs Error]', err);
        return [];
      }
    }

    // --- Supabase Path ---
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('job_data')
          .select('*')
          .order('posted_date', { ascending: false });

        if (error) {
          console.error('[Supabase Fetch Jobs Error]', error);
          return [];
        }

        return (data || []).map((row: any) => ({
          id: row.id,
          title: row.title,
          departmentOrCompany: row.department_or_company,
          description: row.description,
          skills: Array.isArray(row.skills) ? row.skills : JSON.parse(row.skills || '[]'),
          stipend: row.stipend,
          duration: row.duration,
          workMode: row.work_mode,
          domain: row.domain,
          eligibility: row.eligibility,
          postedDate: row.posted_date,
        }));
      } catch (err) {
        console.error('[Supabase Error]', err);
        return [];
      }
    }

    // --- Local SQL Server Fallback ---
    try {
      const res = await fetch('/api/jobs');
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  },

  async create(job: Omit<Internship, 'id' | 'postedDate'>): Promise<Internship> {
    const today = new Date().toISOString().split('T')[0];

    // --- Firebase Firestore Path ---
    if (isFirebaseConfigured && db) {
      const newDoc = await addDoc(collection(db, 'job_data'), {
        title: job.title.trim(),
        department_or_company: job.departmentOrCompany.trim(),
        description: job.description.trim(),
        skills: job.skills,
        stipend: job.stipend.trim(),
        duration: job.duration.trim(),
        work_mode: job.workMode,
        domain: job.domain,
        eligibility: job.eligibility.trim(),
        posted_date: today,
      });

      return {
        id: newDoc.id,
        title: job.title,
        departmentOrCompany: job.departmentOrCompany,
        description: job.description,
        skills: job.skills,
        stipend: job.stipend,
        duration: job.duration,
        workMode: job.workMode,
        domain: job.domain,
        eligibility: job.eligibility,
        postedDate: today,
      };
    }

    // --- Supabase Path ---
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('job_data')
        .insert([
          {
            title: job.title.trim(),
            department_or_company: job.departmentOrCompany.trim(),
            description: job.description.trim(),
            skills: job.skills,
            stipend: job.stipend.trim(),
            duration: job.duration.trim(),
            work_mode: job.workMode,
            domain: job.domain,
            eligibility: job.eligibility.trim(),
            posted_date: today,
          },
        ])
        .select()
        .single();

      if (error) {
        console.error('[Supabase Create Job Error]', error);
        throw new Error(error.message || 'Failed to insert job into Supabase.');
      }

      return {
        id: data.id,
        title: data.title,
        departmentOrCompany: data.department_or_company,
        description: data.description,
        skills: Array.isArray(data.skills) ? data.skills : JSON.parse(data.skills || '[]'),
        stipend: data.stipend,
        duration: data.duration,
        workMode: data.work_mode,
        domain: data.domain,
        eligibility: data.eligibility,
        postedDate: data.posted_date,
      };
    }

    // --- Local SQL Server Fallback ---
    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to save job to SQL database.');
    }
    return await res.json();
  },

  async delete(id: string): Promise<boolean> {
    // --- Firebase Firestore Path ---
    if (isFirebaseConfigured && db) {
      try {
        await deleteDoc(doc(db, 'job_data', id));
        return true;
      } catch (err) {
        console.error('[Firebase Delete Job Error]', err);
        return false;
      }
    }

    // --- Supabase Path ---
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('job_data').delete().eq('id', id);
      return !error;
    }

    // --- Local SQL Server Fallback ---
    const res = await fetch(`/api/jobs/${id}`, {
      method: 'DELETE',
    });
    return res.ok;
  },
};

// ============================================
// 3. User Data (Applications & Resume Files)
// ============================================
export const applicationsApi = {
  async getAll(): Promise<SubmittedApplication[]> {
    // --- Firebase Firestore Path ---
    if (isFirebaseConfigured && db) {
      try {
        const snap = await getDocs(collection(db, 'user_data'));
        const list: SubmittedApplication[] = [];
        snap.forEach((d) => {
          const row = d.data();
          list.push({
            id: d.id,
            candidate: {
              rollNumber: row.roll_number || '',
              name: row.name || '',
              email: row.email || '',
              phone: row.phone || '',
              collegeName: row.college_name || '',
              degree: row.degree || '',
              department: row.department || '',
              academicYear: row.academic_year || '',
              graduationYear: row.graduation_year || '',
              cgpa: row.cgpa || '',
              skills: Array.isArray(row.skills) ? row.skills : JSON.parse(row.skills || '[]'),
              projects: row.projects || '',
              experience: row.experience || '',
              preferredDomain: row.preferred_domain || '',
              availability: row.availability || '',
              github: row.github || '',
              linkedin: row.linkedin || '',
              portfolio: row.portfolio || '',
              resumeFileName: row.resume_filename || undefined,
              resumeFileUrl: row.resume_url || undefined,
            },
            internshipId: row.internship_id,
            internshipTitle: row.internship_title,
            appliedDate: (row.submitted_at || new Date().toISOString()).split('T')[0],
          });
        });
        return list.sort((a, b) => b.appliedDate.localeCompare(a.appliedDate));
      } catch (err) {
        console.error('[Firebase Fetch Applications Error]', err);
        return [];
      }
    }

    // --- Supabase Path ---
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('user_data')
          .select('*')
          .order('submitted_at', { ascending: false });

        if (error) {
          console.error('[Supabase Fetch Applications Error]', error);
          return [];
        }

        return (data || []).map((row: any) => ({
          id: row.id,
          candidate: {
            rollNumber: row.roll_number,
            name: row.name,
            email: row.email,
            phone: row.phone,
            collegeName: row.college_name,
            degree: row.degree,
            department: row.department,
            academicYear: row.academic_year,
            graduationYear: row.graduation_year,
            cgpa: row.cgpa,
            skills: Array.isArray(row.skills) ? row.skills : JSON.parse(row.skills || '[]'),
            projects: row.projects,
            experience: row.experience,
            preferredDomain: row.preferred_domain,
            availability: row.availability,
            github: row.github,
            linkedin: row.linkedin,
            portfolio: row.portfolio,
            resumeFileName: row.resume_filename,
            resumeFileUrl: row.resume_url,
          },
          internshipId: row.internship_id,
          internshipTitle: row.internship_title,
          appliedDate: (row.submitted_at || new Date().toISOString()).split('T')[0],
        }));
      } catch (err) {
        console.error('[Supabase Applications Error]', err);
        return [];
      }
    }

    // --- Local SQL Server Fallback ---
    try {
      const res = await fetch('/api/applications');
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  },

  async submit(
    candidate: CandidateProfile,
    resumeFile: File | null,
    internshipId?: string,
    internshipTitle?: string
  ): Promise<SubmittedApplication> {
    const today = new Date().toISOString().split('T')[0];
    const nowIso = new Date().toISOString();

    // --- Firebase Firestore Path ---
    if (isFirebaseConfigured && db) {
      let uploadedResumeUrl: string | undefined = candidate.resumeFileUrl;
      let uploadedResumeFilename: string | undefined = candidate.resumeFileName;

      // 1. Upload resume to Firebase Cloud Storage if enabled, or convert to Data URL fallback
      if (resumeFile) {
        uploadedResumeFilename = resumeFile.name;
        let storageSuccess = false;

        if (storage) {
          try {
            const ext = resumeFile.name.split('.').pop() || 'pdf';
            const safeRoll = (candidate.rollNumber || 'student').replace(/[^a-zA-Z0-9]/g, '_');
            const safeName = `${safeRoll}_${Date.now()}.${ext}`;
            const storageRef = ref(storage, `resumes/${safeName}`);

            await uploadBytes(storageRef, resumeFile, {
              contentType: resumeFile.type || 'application/pdf',
            });
            uploadedResumeUrl = await getDownloadURL(storageRef);
            storageSuccess = true;
          } catch (storageErr) {
            console.warn('[Firebase Storage requires Blaze/Billing. Using Firestore Base64 Data URL fallback]');
          }
        }

        // Fallback: If Cloud Storage is not enabled or requires Blaze, embed as Base64 Data URL
        if (!storageSuccess) {
          try {
            const base64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(resumeFile);
            });
            uploadedResumeUrl = base64;
          } catch (b64Err) {
            console.warn('[Resume Base64 conversion warning]', b64Err);
          }
        }
      }

      // 2. Insert into Firestore 'user_data' collection
      const docRef = await addDoc(collection(db, 'user_data'), {
        roll_number: candidate.rollNumber.trim().toUpperCase(),
        name: candidate.name.trim(),
        email: candidate.email.trim(),
        phone: candidate.phone.trim(),
        college_name: candidate.collegeName.trim(),
        degree: candidate.degree.trim(),
        department: candidate.department.trim(),
        academic_year: candidate.academicYear,
        graduation_year: candidate.graduationYear,
        cgpa: candidate.cgpa || '',
        skills: candidate.skills,
        projects: candidate.projects || '',
        experience: candidate.experience || '',
        preferred_domain: candidate.preferredDomain || '',
        availability: candidate.availability || '',
        github: candidate.github || '',
        linkedin: candidate.linkedin || '',
        portfolio: candidate.portfolio || '',
        resume_filename: uploadedResumeFilename || '',
        resume_url: uploadedResumeUrl || '',
        internship_id: internshipId || '',
        internship_title: internshipTitle || '',
        submitted_at: nowIso,
      });

      return {
        id: docRef.id,
        candidate: {
          ...candidate,
          resumeFileName: uploadedResumeFilename,
          resumeFileUrl: uploadedResumeUrl,
        },
        internshipId,
        internshipTitle,
        appliedDate: today,
      };
    }

    // --- Supabase Path ---
    if (isSupabaseConfigured) {
      let uploadedResumeUrl: string | undefined = undefined;
      let uploadedResumeFilename: string | undefined = candidate.resumeFileName;

      if (resumeFile) {
        try {
          const fileExt = resumeFile.name.split('.').pop() || 'pdf';
          const safeName = `${candidate.rollNumber.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.${fileExt}`;

          const { error: uploadError } = await supabase.storage
            .from('resumes')
            .upload(safeName, resumeFile, {
              cacheControl: '3600',
              upsert: true,
            });

          if (!uploadError) {
            uploadedResumeFilename = resumeFile.name;
            const { data: publicData } = supabase.storage.from('resumes').getPublicUrl(safeName);
            uploadedResumeUrl = publicData?.publicUrl;
          } else {
            console.warn('[Supabase Storage Upload Warning]', uploadError);
          }
        } catch (uploadErr) {
          console.warn('[Supabase Storage Upload Error]', uploadErr);
        }
      }

      const { data, error } = await supabase
        .from('user_data')
        .insert([
          {
            roll_number: candidate.rollNumber.trim().toUpperCase(),
            name: candidate.name.trim(),
            email: candidate.email.trim(),
            phone: candidate.phone.trim(),
            college_name: candidate.collegeName.trim(),
            degree: candidate.degree.trim(),
            department: candidate.department.trim(),
            academic_year: candidate.academicYear,
            graduation_year: candidate.graduationYear,
            cgpa: candidate.cgpa || '',
            skills: candidate.skills,
            projects: candidate.projects || '',
            experience: candidate.experience || '',
            preferred_domain: candidate.preferredDomain || '',
            availability: candidate.availability || '',
            github: candidate.github || '',
            linkedin: candidate.linkedin || '',
            portfolio: candidate.portfolio || '',
            resume_filename: uploadedResumeFilename || '',
            resume_url: uploadedResumeUrl || '',
            internship_id: internshipId || '',
            internship_title: internshipTitle || '',
          },
        ])
        .select()
        .single();

      if (error) {
        console.error('[Supabase Application Insert Error]', error);
        throw new Error(error.message || 'Failed to save application in Supabase.');
      }

      return {
        id: data.id,
        candidate: {
          ...candidate,
          resumeFileName: uploadedResumeFilename,
          resumeFileUrl: uploadedResumeUrl,
        },
        internshipId,
        internshipTitle,
        appliedDate: today,
      };
    }

    // --- Local SQL Server Fallback ---
    const formData = new FormData();
    const { resumeFile: _omitted, ...cleanCandidate } = candidate;
    formData.append('candidate', JSON.stringify(cleanCandidate));

    if (internshipId) formData.append('internshipId', internshipId);
    if (internshipTitle) formData.append('internshipTitle', internshipTitle);

    if (resumeFile) {
      formData.append('resume', resumeFile, resumeFile.name);
    }

    const res = await fetch('/api/applications', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to save application to SQL database.');
    }

    const data = await res.json();
    return data.application;
  },
};
