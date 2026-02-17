require('dotenv').config();
const mysql = require('mysql2');

console.log('Testing database connection...');
console.log('Host:', process.env.DB_HOST);
console.log('Port:', process.env.DB_PORT);
console.log('User:', process.env.DB_USER);
console.log('Database:', process.env.DB_NAME);

const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

connection.connect((err) => {
    if (err) {
        console.error('❌ Connection failed:', err);
    } else {
        console.log('✅ Connection successful!');
        
        // Check if admins table exists
        connection.query('SELECT * FROM admins', (err, results) => {
            if (err) {
                console.error('❌ Query failed:', err);
            } else {
                console.log('✅ Admins table query successful');
                console.log('Admins found:', results.length);
                console.log('Admin data:', results);
            }
            connection.end();
        });
    }
});