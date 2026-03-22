const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const db = new Database('restaurant.db');

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    capacity INTEGER NOT NULL,
    location TEXT
  );
  
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id INTEGER NOT NULL,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    booking_date TEXT NOT NULL,
    booking_time TEXT NOT NULL,
    party_size INTEGER NOT NULL,
    special_requests TEXT,
    status TEXT DEFAULT 'confirmed',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (table_id) REFERENCES tables(id)
  );
  
  INSERT OR IGNORE INTO tables (id, name, capacity, location) VALUES
    (1, 'Table 1', 2, 'Window'),
    (2, 'Table 2', 4, 'Center'),
    (3, 'Table 3', 4, 'Center'),
    (4, 'Table 4', 6, 'Patio'),
    (5, 'Table 5', 8, 'Private Room'),
    (6, 'Table 6', 2, 'Window'),
    (7, 'Table 7', 4, 'Bar'),
    (8, 'Table 8', 6, 'Patio');
`);

app.use(express.json());
app.use(express.static('public'));

// API: Get all tables
app.get('/api/tables', (req, res) => {
  const tables = db.prepare('SELECT * FROM tables').all();
  res.json(tables);
});

// API: Get available tables for date/time
app.get('/api/tables/available', (req, res) => {
  const { date, time, party_size } = req.query;
  const stmt = db.prepare(`
    SELECT t.* FROM tables t
    WHERE t.capacity >= ? 
    AND t.id NOT IN (
      SELECT table_id FROM bookings 
      WHERE booking_date = ? AND booking_time = ? AND status != 'cancelled'
    )
    ORDER BY t.capacity
  `);
  const tables = stmt.all(party_size || 1, date, time);
  res.json(tables);
});

// API: Create booking
app.post('/api/bookings', (req, res) => {
  const { table_id, customer_name, customer_email, customer_phone, booking_date, booking_time, party_size, special_requests } = req.body;
  
  // Check if table is already booked
  const existing = db.prepare(`
    SELECT * FROM bookings WHERE table_id = ? AND booking_date = ? AND booking_time = ? AND status != 'cancelled'
  `).get(table_id, booking_date, booking_time);
  
  if (existing) {
    return res.status(400).json({ error: 'Table already booked for this time' });
  }
  
  const stmt = db.prepare(`
    INSERT INTO bookings (table_id, customer_name, customer_email, customer_phone, booking_date, booking_time, party_size, special_requests)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(table_id, customer_name, customer_email, customer_phone, booking_date, booking_time, party_size, special_requests || '');
  
  res.json({ id: result.lastInsertRowid, message: 'Booking confirmed!' });
});

// API: Get all bookings (owner)
app.get('/api/bookings', (req, res) => {
  const { date, status } = req.query;
  let query = `
    SELECT b.*, t.name as table_name, t.capacity, t.location
    FROM bookings b
    JOIN tables t ON b.table_id = t.id
    WHERE 1=1
  `;
  const params = [];
  
  if (date) {
    query += ' AND b.booking_date = ?';
    params.push(date);
  }
  if (status) {
    query += ' AND b.status = ?';
    params.push(status);
  }
  
  query += ' ORDER BY b.booking_date, b.booking_time';
  
  const bookings = db.prepare(query).all(...params);
  res.json(bookings);
});

// API: Update booking status
app.patch('/api/bookings/:id', (req, res) => {
  const { status } = req.body;
  const stmt = db.prepare('UPDATE bookings SET status = ? WHERE id = ?');
  stmt.run(status, req.params.id);
  res.json({ message: 'Booking updated' });
});

// API: Delete booking
app.delete('/api/bookings/:id', (req, res) => {
  db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
  res.json({ message: 'Booking deleted' });
});

// API: Stats
app.get('/api/stats', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  
  const totalTables = db.prepare('SELECT COUNT(*) as count FROM tables').get().count;
  const todayBookings = db.prepare('SELECT COUNT(*) as count FROM bookings WHERE booking_date = ?').get(today).count;
  const totalBookings = db.prepare('SELECT COUNT(*) as count FROM bookings').get().count;
  const pendingBookings = db.prepare("SELECT COUNT(*) as count FROM bookings WHERE status = 'pending'").get().count;
  
  res.json({ totalTables, todayBookings, totalBookings, pendingBookings });
});

// Serve frontend
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));