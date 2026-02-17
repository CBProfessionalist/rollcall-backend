const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Database connection
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'rollcall_db'
});

db.connect((err) => {
    if (err) {
        console.error('Database connection failed:', err);
        return;
    }
    console.log('Connected to database');
});

// Email configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// API Endpoints

// Record attendance scan
app.post('/api/attendance/scan', (req, res) => {
    const { ic_number } = req.body;
    const now = new Date();
    const scan_date = now.toISOString().split('T')[0];
    const scan_time = now.toTimeString().split(' ')[0];
    const scan_datetime = now.toISOString().slice(0, 19).replace('T', ' ');

    // Check if it's a holiday or weekend
    const dayOfWeek = now.getDay(); // 0 = Sunday, 6 = Saturday
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Get settings
    db.query('SELECT setting_key, setting_value FROM settings', (err, settings) => {
        if (err) {
            console.error('Error fetching settings:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        const settingsMap = {};
        settings.forEach(s => settingsMap[s.setting_key] = s.setting_value);

        // Check if weekend is off
        if (isWeekend && settingsMap['weekend_off'] === 'true') {
            return res.json({ 
                success: false, 
                message: 'Weekend - attendance not required',
                status: 'weekend'
            });
        }

        // Check if holiday
        db.query('SELECT * FROM holidays WHERE holiday_date = ?', [scan_date], (err, holidays) => {
            if (err) {
                console.error('Error checking holiday:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            if (holidays.length > 0 && settingsMap['holiday_off'] === 'true') {
                return res.json({ 
                    success: false, 
                    message: 'Holiday - attendance not required',
                    status: 'holiday'
                });
            }

            // Get student info
            db.query('SELECT * FROM students WHERE ic_number = ?', [ic_number], (err, students) => {
                if (err) {
                    console.error('Error fetching student:', err);
                    return res.status(500).json({ error: 'Database error' });
                }

                if (students.length === 0) {
                    return res.status(404).json({ error: 'Student not found' });
                }

                const student = students[0];

                // Insert attendance record
                const query = `INSERT INTO attendance 
                    (ic_number, student_id, student_name, scan_date, scan_time, scan_datetime) 
                    VALUES (?, ?, ?, ?, ?, ?)`;

                db.query(query, [
                    ic_number,
                    student.student_id,
                    student.student_name,
                    scan_date,
                    scan_time,
                    scan_datetime
                ], (err, result) => {
                    if (err) {
                        console.error('Error recording attendance:', err);
                        return res.status(500).json({ error: 'Failed to record attendance' });
                    }

                    res.json({ 
                        success: true, 
                        message: 'Attendance recorded successfully',
                        student: student
                    });
                });
            });
        });
    });
});

// Get all students
app.get('/api/students', (req, res) => {
    db.query('SELECT * FROM students ORDER BY student_id', (err, results) => {
        if (err) {
            console.error('Error fetching students:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(results);
    });
});

// Add new student
app.post('/api/students', (req, res) => {
    const { ic_number, student_id, student_name } = req.body;
    
    db.query('INSERT INTO students (ic_number, student_id, student_name) VALUES (?, ?, ?)',
        [ic_number, student_id, student_name],
        (err, result) => {
            if (err) {
                console.error('Error adding student:', err);
                return res.status(500).json({ error: 'Failed to add student' });
            }
            res.json({ success: true, message: 'Student added successfully' });
        }
    );
});

// Get attendance records with filters
app.get('/api/attendance', (req, res) => {
    const { start_date, end_date, student_id } = req.query;
    let query = 'SELECT * FROM attendance WHERE 1=1';
    const params = [];

    if (start_date) {
        query += ' AND scan_date >= ?';
        params.push(start_date);
    }
    if (end_date) {
        query += ' AND scan_date <= ?';
        params.push(end_date);
    }
    if (student_id) {
        query += ' AND student_id = ?';
        params.push(student_id);
    }

    query += ' ORDER BY scan_datetime DESC';

    db.query(query, params, (err, results) => {
        if (err) {
            console.error('Error fetching attendance:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(results);
    });
});

// Get settings
app.get('/api/settings', (req, res) => {
    db.query('SELECT * FROM settings', (err, results) => {
        if (err) {
            console.error('Error fetching settings:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(results);
    });
});

// Update settings
app.post('/api/settings', (req, res) => {
    const settings = req.body;
    
    const queries = Object.keys(settings).map(key => {
        return new Promise((resolve, reject) => {
            db.query('UPDATE settings SET setting_value = ? WHERE setting_key = ?',
                [settings[key], key],
                (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                }
            );
        });
    });

    Promise.all(queries)
        .then(() => res.json({ success: true, message: 'Settings updated' }))
        .catch(err => {
            console.error('Error updating settings:', err);
            res.status(500).json({ error: 'Failed to update settings' });
        });
});

// Add holiday
app.post('/api/holidays', (req, res) => {
    const { holiday_date, description } = req.body;
    
    db.query('INSERT INTO holidays (holiday_date, description) VALUES (?, ?)',
        [holiday_date, description],
        (err, result) => {
            if (err) {
                console.error('Error adding holiday:', err);
                return res.status(500).json({ error: 'Failed to add holiday' });
            }
            res.json({ success: true, message: 'Holiday added successfully' });
        }
    );
});

// Get holidays
app.get('/api/holidays', (req, res) => {
    db.query('SELECT * FROM holidays ORDER BY holiday_date', (err, results) => {
        if (err) {
            console.error('Error fetching holidays:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(results);
    });
});

// Check for absent students and send notifications
function checkAbsences() {
    const today = new Date().toISOString().split('T')[0];
    
    // Get settings
    db.query('SELECT setting_key, setting_value FROM settings', (err, settings) => {
        if (err) {
            console.error('Error fetching settings:', err);
            return;
        }

        const settingsMap = {};
        settings.forEach(s => settingsMap[s.setting_key] = s.setting_value);

        if (settingsMap['notifications_enabled'] !== 'true') {
            return;
        }

        // Check if today is holiday or weekend
        const dayOfWeek = new Date().getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        db.query('SELECT * FROM holidays WHERE holiday_date = ?', [today], (err, holidays) => {
            if (err) {
                console.error('Error checking holiday:', err);
                return;
            }

            if ((isWeekend && settingsMap['weekend_off'] === 'true') || 
                (holidays.length > 0 && settingsMap['holiday_off'] === 'true')) {
                console.log('Today is off - skipping absence check');
                return;
            }

            // Find absent students
            const query = `
                SELECT s.*, 
                       COUNT(a.id) as days_present,
                       DATEDIFF(CURDATE(), MAX(a.scan_date)) as days_absent
                FROM students s
                LEFT JOIN attendance a ON s.student_id = a.student_id 
                    AND a.scan_date >= DATE_SUB(CURDATE(), INTERVAL 5 DAY)
                WHERE NOT EXISTS (
                    SELECT 1 FROM attendance 
                    WHERE student_id = s.student_id 
                    AND scan_date = CURDATE()
                )
                GROUP BY s.id
                HAVING days_present = 0 OR days_absent >= 1
            `;

            db.query(query, (err, absentStudents) => {
                if (err) {
                    console.error('Error checking absences:', err);
                    return;
                }

                absentStudents.forEach(student => {
                    const daysAbsent = student.days_absent || 1;
                    
                    let alertType = '';
                    if (daysAbsent === 1) {
                        alertType = '1-day absence';
                    } else if (daysAbsent === 3) {
                        alertType = '3-day consecutive absence';
                    } else if (daysAbsent >= 5) {
                        alertType = '5+ day absence (REPORT REQUIRED)';
                    }

                    if (alertType) {
                        sendAbsenceAlert(student, daysAbsent, alertType, settingsMap['email_recipient']);
                    }
                });
            });
        });
    });
}

function sendAbsenceAlert(student, daysAbsent, alertType, recipient) {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: recipient,
        subject: `Attendance Alert: ${student.student_name} - ${alertType}`,
        html: `
            <h2>Attendance Alert</h2>
            <p><strong>Student:</strong> ${student.student_name}</p>
            <p><strong>Student ID:</strong> ${student.student_id}</p>
            <p><strong>IC Number:</strong> ${student.ic_number}</p>
            <p><strong>Alert Type:</strong> ${alertType}</p>
            <p><strong>Days Absent:</strong> ${daysAbsent}</p>
            <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
            <hr>
            <p>Please take appropriate action.</p>
        `
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('Error sending email:', error);
        } else {
            console.log('Alert email sent:', info.response);
        }
    });
}

// Schedule absence checks (run daily at 10 AM)
cron.schedule('0 10 * * *', checkAbsences);

// Schedule weekend/holiday checks (run every hour)
cron.schedule('0 * * * *', () => {
    console.log('Checking for weekend/holiday status...');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});