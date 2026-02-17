require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const nodemailer = require('nodemailer');
const cron = require('node-cron');

const app = express();

// Middleware
// CORS configuration - FIXED FOR PRODUCTION
app.use(cors({
    origin: [
        'http://localhost:8000',
        'https://rollcall-frontend-61ovs9ov1-naqshs-projects-fe659bc5.vercel.app',
        'https://rollcall-frontend.vercel.app'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Session configuration - FIXED FOR PRODUCTION
app.use(session({
    secret: process.env.SESSION_SECRET || 'rollcall-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: true,           // MUST be true for HTTPS (Render uses HTTPS)
        httpOnly: true,
        sameSite: 'none',        // Required for cross-site requests (Vercel to Render)
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    },
    proxy: true // Trust the reverse proxy (Render)
}));

// Database
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

db.connect((err) => {
    if (err) {
        console.error('❌ Database connection failed:', err);
        return;
    }
    console.log('✅ Connected to Railway database');
});

// ========== AUTH MIDDLEWARE ==========
const requireLogin = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

// ========== EMAIL CONFIGURATION ==========
// Email configuration - FIXED FOR RENDER (using port 587)
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // true for 465, false for 587
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false,
        ciphers: 'SSLv3'
    },
    connectionTimeout: 30000, // 30 seconds
    greetingTimeout: 30000,
    socketTimeout: 30000,
    debug: true // Enable debug logs
});

// Test email connection
transporter.verify((error, success) => {
    if (error) {
        console.log('❌ Email configuration error:', error.message);
        console.log('📧 Email notifications may not work - check port 587');
        console.log('📧 Make sure EMAIL_USER and EMAIL_PASS are set in environment');
    } else {
        console.log('✅ Email server ready on port 587');
    }
});

// Store sent alerts to prevent duplicates
const sentAlerts = new Set();

// ========== EMAIL FUNCTIONS ==========
async function sendAbsenceAlert(student, daysAbsent, alertType) {
    // Check if notifications are enabled
    db.query('SELECT setting_value FROM settings WHERE setting_key = "notifications_enabled"', async (err, result) => {
        if (err) {
            console.error('❌ Error checking notification settings:', err);
            return;
        }
        
        if (result.length === 0) {
            console.log('📧 No notification settings found');
            return;
        }
        
        const notificationsEnabled = result[0].setting_value === 'true';
        if (!notificationsEnabled) {
            console.log('📧 Notifications are disabled in settings');
            return;
        }
        
        // Get recipient email
        db.query('SELECT setting_value FROM settings WHERE setting_key = "email_recipient"', async (err, emailResult) => {
            if (err) {
                console.error('❌ Error fetching email recipient:', err);
                return;
            }
            
            let recipient = process.env.ADMIN_EMAIL || 'admin@school.edu';
            if (emailResult && emailResult.length > 0) {
                recipient = emailResult[0].setting_value;
            }
            
            console.log(`📧 Preparing to send ${alertType} email for ${student.student_name} to ${recipient}`);
            
            const mailOptions = {
                from: `"Rollcall System" <${process.env.EMAIL_USER}>`,
                to: recipient,
                subject: `⚠️ Attendance Alert: ${student.student_name} - ${alertType}`,
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <style>
                            body { font-family: Arial, sans-serif; line-height: 1.6; }
                            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                            .header { background: linear-gradient(135deg, #00f2fe, #4facfe); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
                            .content { background: #f5f5f5; padding: 20px; border-radius: 0 0 10px 10px; }
                            .alert-box { background: ${alertType.includes('URGENT') ? '#ff1744' : '#ff9800'}; color: white; padding: 15px; border-radius: 5px; margin: 20px 0; }
                            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                            td { padding: 10px; border-bottom: 1px solid #ddd; }
                            .label { font-weight: bold; width: 40%; background: #f0f0f0; }
                            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <h1>📱 Rollcall Attendance System</h1>
                            </div>
                            <div class="content">
                                <h2 style="color: #333; margin-top: 0;">Attendance Alert</h2>
                                
                                <div class="alert-box">
                                    <strong>⚠️ ${alertType}</strong>
                                </div>
                                
                                <table>
                                    <tr>
                                        <td class="label">Student Name:</td>
                                        <td>${student.student_name}</td>
                                    </tr>
                                    <tr>
                                        <td class="label">Student ID:</td>
                                        <td>${student.student_id}</td>
                                    </tr>
                                    <tr>
                                        <td class="label">IC Number:</td>
                                        <td>${student.ic_number}</td>
                                    </tr>
                                    <tr>
                                        <td class="label">Days Absent:</td>
                                        <td><strong>${daysAbsent} day${daysAbsent > 1 ? 's' : ''}</strong></td>
                                    </tr>
                                    <tr>
                                        <td class="label">Alert Type:</td>
                                        <td><strong style="color: ${alertType.includes('URGENT') ? '#ff1744' : '#ff9800'}">${alertType}</strong></td>
                                    </tr>
                                    <tr>
                                        <td class="label">Date:</td>
                                        <td>${new Date().toLocaleDateString()}</td>
                                    </tr>
                                </table>
                                
                                <p style="background: #fff3e0; padding: 15px; border-radius: 5px; border-left: 4px solid #ff9800;">
                                    <strong>Action Required:</strong> Please follow up with this student regarding their attendance.
                                </p>
                                
                                <div style="text-align: center; margin-top: 30px;">
                                    <a href="https://rollcall-frontend.vercel.app/login.html" 
                                       style="background: linear-gradient(135deg, #00f2fe, #4facfe); 
                                              color: #0a0f1f; 
                                              padding: 12px 30px; 
                                              text-decoration: none; 
                                              border-radius: 5px; 
                                              font-weight: bold;
                                              display: inline-block;">
                                        🔐 Login to Dashboard
                                    </a>
                                </div>
                            </div>
                            <div class="footer">
                                <p>This is an automated message from your Rollcall Attendance System.</p>
                                <p style="font-size: 10px;">© ${new Date().getFullYear()} Rollcall Scanner</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `
            };

            try {
                console.log(`📧 Sending email for ${student.student_name}...`);
                const info = await transporter.sendMail(mailOptions);
                console.log(`✅ Email sent successfully for ${student.student_name}`);
                console.log(`📧 Message ID: ${info.messageId}`);
            } catch (error) {
                console.error(`❌ Failed to send email for ${student.student_name}:`, error.message);
                console.error('Error code:', error.code);
                console.error('Command:', error.command);
                
                // Log additional details for debugging
                console.log('📧 Email configuration:', {
                    host: 'smtp.gmail.com',
                    port: 587,
                    user: process.env.EMAIL_USER ? 'Set' : 'Not set',
                    recipient: recipient
                });
            }
        });
    });
}

// Check for absent students
async function checkAbsences() {
    console.log('🔍 Running absence check at:', new Date().toLocaleString());
    
    const today = new Date().toISOString().split('T')[0];
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const fiveDaysAgoStr = fiveDaysAgo.toISOString().split('T')[0];
    
    // Get all students
    db.query('SELECT * FROM students', async (err, students) => {
        if (err) {
            console.error('❌ Error fetching students:', err);
            return;
        }
        
        console.log(`📊 Found ${students.length} students to check`);
        
        for (const student of students) {
            // Get attendance for last 5 days
            db.query(
                'SELECT * FROM attendance WHERE student_id = ? AND scan_date >= ? ORDER BY scan_date',
                [student.student_id, fiveDaysAgoStr],
                async (err, attendance) => {
                    if (err) return;
                    
                    const daysPresent = attendance.length;
                    const daysAbsent = 5 - daysPresent;
                    
                    // Only process if student has been absent
                    if (daysAbsent === 0) return;
                    
                    console.log(`📊 ${student.student_name}: ${daysPresent} present, ${daysAbsent} absent`);
                    
                    // Create a unique key for this alert
                    const alertKey = `${student.id}_${today}_${daysAbsent}`;
                    
                    // Check if weekend/holiday exclusions apply
                    db.query('SELECT setting_value FROM settings WHERE setting_key IN ("weekend_off", "holiday_off")', async (err, settings) => {
                        if (err) return;
                        
                        const weekendOff = settings.find(s => s.setting_key === 'weekend_off')?.setting_value === 'true';
                        const holidayOff = settings.find(s => s.setting_key === 'holiday_off')?.setting_value === 'true';
                        
                        // Check if today is a holiday
                        if (holidayOff) {
                            db.query('SELECT * FROM holidays WHERE holiday_date = ?', [today], (err, holidays) => {
                                if (holidays && holidays.length > 0) {
                                    console.log('📅 Today is a holiday, skipping alerts');
                                    return;
                                }
                            });
                        }
                        
                        // Check if today is weekend
                        const dayOfWeek = new Date().getDay();
                        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                        
                        if (weekendOff && isWeekend) {
                            console.log('📅 Today is weekend, skipping alerts');
                            return;
                        }
                        
                        // Send alerts based on absence duration
                        if (daysAbsent >= 5 && !sentAlerts.has(alertKey + '_5')) {
                            console.log(`⚠️ Sending URGENT alert for ${student.student_name} (${daysAbsent} days)`);
                            await sendAbsenceAlert(student, daysAbsent, '5+ DAYS - URGENT');
                            sentAlerts.add(alertKey + '_5');
                        }
                        else if (daysAbsent === 3 && !sentAlerts.has(alertKey + '_3')) {
                            console.log(`⚠️ Sending 3-day alert for ${student.student_name}`);
                            await sendAbsenceAlert(student, daysAbsent, '3 DAYS CONSECUTIVE');
                            sentAlerts.add(alertKey + '_3');
                        }
                        else if (daysAbsent === 1 && !sentAlerts.has(alertKey + '_1')) {
                            console.log(`⚠️ Sending 1-day alert for ${student.student_name}`);
                            await sendAbsenceAlert(student, daysAbsent, '1 DAY ABSENCE');
                            sentAlerts.add(alertKey + '_1');
                        }
                    });
                }
            );
        }
    });
}

// Schedule absence checks (every day at 10 AM)
cron.schedule('0 10 * * *', () => {
    console.log('⏰ Running scheduled absence check...');
    checkAbsences();
});

// ========== AUTH ROUTES ==========
// Login route - FIXED
app.post('/api/login', (req, res) => {
    console.log('📝 Login attempt:', req.body.username);
    
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    db.query('SELECT * FROM admins WHERE username = ?', [username], (err, results) => {
        if (err || results.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const admin = results[0];
        
        if (password === admin.password) {
            req.session.userId = admin.id;
            req.session.username = admin.username;
            
            // Save session explicitly
            req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);
                    return res.status(500).json({ error: 'Session error' });
                }
                
                console.log('✅ Login successful for:', username);
                res.json({ 
                    success: true, 
                    message: 'Login successful',
                    user: { 
                        id: admin.id,
                        username: admin.username,
                        email: admin.email 
                    }
                });
            });
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

// Check auth route - FIXED
app.get('/api/check-auth', (req, res) => {
    console.log('🔍 Check-auth called. Session:', req.sessionID);
    console.log('User ID:', req.session.userId);
    
    if (req.session.userId) {
        res.json({ 
            loggedIn: true, 
            user: { 
                id: req.session.userId,
                username: req.session.username 
            } 
        });
    } else {
        res.json({ loggedIn: false });
    }
});

app.get('/', (req, res) => {
    res.json({ message: '🎓 Rollcall API', status: 'running' });
});

// ========== PROTECTED ROUTES ==========

// Manual trigger for testing
app.get('/api/check-absences', requireLogin, (req, res) => {
    console.log('👤 Manual absence check triggered by:', req.session.username);
    checkAbsences();
    res.json({ message: 'Absence check started' });
});

// Student routes
app.get('/api/students', requireLogin, (req, res) => {
    db.query('SELECT * FROM students ORDER BY student_id', (err, results) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(results);
        }
    });
});

app.post('/api/students', requireLogin, (req, res) => {
    const { ic_number, student_id, student_name } = req.body;
    
    db.query(
        'INSERT INTO students (ic_number, student_id, student_name) VALUES (?, ?, ?)',
        [ic_number, student_id, student_name],
        (err) => {
            if (err) {
                res.status(500).json({ error: err.message });
            } else {
                res.json({ success: true });
            }
        }
    );
});

app.delete('/api/students/:id', requireLogin, (req, res) => {
    db.query('DELETE FROM students WHERE id = ?', [req.params.id], (err) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json({ success: true });
        }
    });
});

// Attendance routes (GET is protected, POST scan is public)
app.get('/api/attendance', requireLogin, (req, res) => {
    let query = 'SELECT * FROM attendance WHERE 1=1';
    const params = [];
    
    if (req.query.start_date) {
        query += ' AND scan_date >= ?';
        params.push(req.query.start_date);
    }
    if (req.query.end_date) {
        query += ' AND scan_date <= ?';
        params.push(req.query.end_date);
    }
    if (req.query.student_id) {
        query += ' AND student_id = ?';
        params.push(req.query.student_id);
    }
    
    query += ' ORDER BY scan_datetime DESC';
    
    db.query(query, params, (err, results) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(results);
        }
    });
});

// Public scan endpoint (no login required)
app.post('/api/attendance/scan', (req, res) => {
    const { ic_number } = req.body;
    const now = new Date();
    const scan_date = now.toISOString().split('T')[0];
    const scan_time = now.toTimeString().split(' ')[0];
    const scan_datetime = now.toISOString().slice(0, 19).replace('T', ' ');

    db.query('SELECT * FROM students WHERE ic_number = ?', [ic_number], (err, students) => {
        if (err || students.length === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        const student = students[0];
        
        db.query(
            'INSERT INTO attendance (ic_number, student_id, student_name, scan_date, scan_time, scan_datetime) VALUES (?, ?, ?, ?, ?, ?)',
            [ic_number, student.student_id, student.student_name, scan_date, scan_time, scan_datetime],
            (err) => {
                if (err) {
                    res.status(500).json({ error: err.message });
                } else {
                    res.json({ success: true, student: student.student_name });
                }
            }
        );
    });
});

// Settings routes
app.get('/api/settings', requireLogin, (req, res) => {
    db.query('SELECT * FROM settings', (err, results) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(results);
        }
    });
});

app.post('/api/settings', requireLogin, (req, res) => {
    const settings = req.body;
    
    const queries = Object.keys(settings).map(key => {
        return new Promise((resolve, reject) => {
            db.query(
                'UPDATE settings SET setting_value = ? WHERE setting_key = ?',
                [settings[key], key],
                (err) => err ? reject(err) : resolve()
            );
        });
    });
    
    Promise.all(queries)
        .then(() => res.json({ success: true }))
        .catch(err => res.status(500).json({ error: err.message }));
});

// Holiday routes
app.get('/api/holidays', requireLogin, (req, res) => {
    db.query('SELECT * FROM holidays ORDER BY holiday_date', (err, results) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(results);
        }
    });
});

app.post('/api/holidays', requireLogin, (req, res) => {
    const { holiday_date, description } = req.body;
    
    db.query(
        'INSERT INTO holidays (holiday_date, description) VALUES (?, ?)',
        [holiday_date, description],
        (err) => {
            if (err) {
                res.status(500).json({ error: err.message });
            } else {
                res.json({ success: true });
            }
        }
    );
});

app.delete('/api/holidays/:id', requireLogin, (req, res) => {
    db.query('DELETE FROM holidays WHERE id = ?', [req.params.id], (err) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json({ success: true });
        }
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📧 Email configured for: ${process.env.EMAIL_USER || 'Not set'}`);
});
