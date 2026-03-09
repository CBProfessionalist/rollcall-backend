require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const cron = require('node-cron');

const app = express();

// CORS configuration
app.use(cors({
    origin: [
        'http://localhost:8000',
        'https://rollcall-frontend.vercel.app'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'rollcall-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: true,
        httpOnly: true,
        sameSite: 'none',
        maxAge: 24 * 60 * 60 * 1000
    },
    proxy: true
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

// ========== TELEGRAM DIRECT INTEGRATION ==========
// Store sent alerts to prevent duplicates
const sentAlerts = new Set();

// Function to send Telegram message directly
async function sendTelegramMessage(chatId, message) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!botToken) {
        console.error('❌ TELEGRAM_BOT_TOKEN not configured');
        return false;
    }
    
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'Markdown'
            })
        });
        
        const data = await response.json();
        if (data.ok) {
            console.log('✅ Telegram message sent');
            return true;
        } else {
            console.error('❌ Telegram error:', data.description);
            return false;
        }
    } catch (error) {
        console.error('❌ Failed to send Telegram message:', error.message);
        return false;
    }
}

// ========== NOTIFICATION FUNCTION ==========
async function sendAttendanceAlert(student, daysAbsent, alertType) {
    // Check if notifications are enabled in settings
    db.query('SELECT setting_value FROM settings WHERE setting_key = "notifications_enabled"', async (err, result) => {
        if (err || result.length === 0) {
            console.error('❌ Error checking notification settings:', err);
            return;
        }
        
        const notificationsEnabled = result[0].setting_value === 'true';
        if (!notificationsEnabled) {
            console.log('📧 Notifications disabled');
            return;
        }
        
        // Get admin Telegram Chat ID from settings
        db.query('SELECT setting_value FROM settings WHERE setting_key = "chat_id"', async (err, chatResult) => {
            if (err) {
                console.error('❌ Error fetching chat ID:', err);
                return;
            }
            
            const chatId = (chatResult && chatResult[0]) ? 
                chatResult[0].setting_value : 
                process.env.ADMIN_CHAT_ID;
            
            if (!chatId) {
                console.log('❌ No chat ID configured for notifications');
                return;
            }
            
            console.log(`📱 Sending ${alertType} alert for ${student.student_name}`);
            
            // Format message with Markdown
            const message = `
🎓 *Rollcall Attendance Alert*

*Student:* ${student.student_name}
*ID:* ${student.student_id}
*IC:* ${student.ic_number}
*Alert:* ${alertType}
*Days Absent:* ${daysAbsent}
*Date:* ${new Date().toLocaleDateString()}

Please follow up with this student.
            `;
            
            // Send directly to Telegram
            await sendTelegramMessage(chatId, message);
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
        
        console.log(`📊 Found ${students.length} students`);
        
        for (const student of students) {
            // Get attendance for last 5 days
            db.query(
                'SELECT * FROM attendance WHERE student_id = ? AND scan_date >= ?',
                [student.student_id, fiveDaysAgoStr],
                async (err, attendance) => {
                    if (err) {
                        console.error('❌ Error fetching attendance:', err);
                        return;
                    }
                    
                    const daysAbsent = 5 - attendance.length;
                    if (daysAbsent === 0) return;
                    
                    // Create unique key for this alert
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
                            await sendAttendanceAlert(student, daysAbsent, '5+ DAYS - URGENT');
                            sentAlerts.add(alertKey + '_5');
                        }
                        else if (daysAbsent === 3 && !sentAlerts.has(alertKey + '_3')) {
                            console.log(`⚠️ Sending 3-day alert for ${student.student_name}`);
                            await sendAttendanceAlert(student, daysAbsent, '3 DAYS CONSECUTIVE');
                            sentAlerts.add(alertKey + '_3');
                        }
                        else if (daysAbsent === 1 && !sentAlerts.has(alertKey + '_1')) {
                            console.log(`⚠️ Sending 1-day alert for ${student.student_name}`);
                            await sendAttendanceAlert(student, daysAbsent, '1 DAY ABSENCE');
                            sentAlerts.add(alertKey + '_1');
                        }
                    });
                }
            );
        }
    });
}

// Schedule absence checks (10 AM daily)
cron.schedule('0 10 * * *', () => {
    console.log('⏰ Running scheduled absence check...');
    checkAbsences();
});

// ========== AUTH ROUTES ==========
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    db.query('SELECT * FROM admins WHERE username = ?', [username], (err, results) => {
        if (err || results.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const admin = results[0];
        
        if (password === admin.password) {
            req.session.userId = admin.id;
            req.session.username = admin.username;
            
            req.session.save((err) => {
                if (err) {
                    return res.status(500).json({ error: 'Session error' });
                }
                res.json({ success: true, user: { username: admin.username } });
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

app.get('/api/check-auth', (req, res) => {
    res.json({ loggedIn: !!req.session.userId });
});

app.get('/', (req, res) => {
    res.json({ message: '🎓 Rollcall API', status: 'running' });
});

// Manual trigger endpoint
app.get('/api/check-absences', requireLogin, (req, res) => {
    console.log('👤 Manual absence check triggered by:', req.session.username);
    checkAbsences();
    res.json({ message: 'Absence check started' });
});

// ========== STUDENT ROUTES ==========
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

// ========== ATTENDANCE ROUTES ==========
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

// Public scan endpoint
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

// ========== SETTINGS ROUTES ==========
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

// ========== HOLIDAY ROUTES ==========
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
    console.log(`📱 Telegram notifications: ${process.env.TELEGRAM_BOT_TOKEN ? 'Configured' : 'Not configured'}`);
});
