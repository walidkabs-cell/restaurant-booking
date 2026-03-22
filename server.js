const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// PostgreSQL connection (Render provides free PostgreSQL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/restaurant',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Initialize database
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS tables (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        capacity INTEGER NOT NULL,
        location TEXT
      );
      
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        table_id INTEGER NOT NULL REFERENCES tables(id),
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        booking_date TEXT NOT NULL,
        booking_time TEXT NOT NULL,
        party_size INTEGER NOT NULL,
        special_requests TEXT,
        status TEXT DEFAULT 'confirmed',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Insert default tables
    const tablesExist = await client.query("SELECT COUNT(*) FROM tables");
    if (tablesExist.rows[0].count === '0') {
      await client.query(`
        INSERT INTO tables (name, capacity, location) VALUES
        ('Table 1', 2, 'Window'),
        ('Table 2', 4, 'Center'),
        ('Table 3', 4, 'Center'),
        ('Table 4', 6, 'Patio'),
        ('Table 5', 8, 'Private Room'),
        ('Table 6', 2, 'Window'),
        ('Table 7', 4, 'Bar'),
        ('Table 8', 6, 'Patio');
      `);
    }
  } finally {
    client.release();
  }
}

initDB().catch(console.error);

// API: Get all tables
app.get('/api/tables', async (req, res) => {
  const result = await pool.query('SELECT * FROM tables ORDER BY id');
  res.json(result.rows);
});

// API: Get available tables
app.get('/api/tables/available', async (req, res) => {
  const { date, time, party_size } = req.query;
  const result = await pool.query(`
    SELECT t.* FROM tables t
    WHERE t.capacity >= $1 
    AND t.id NOT IN (
      SELECT table_id FROM bookings 
      WHERE booking_date = $2 AND booking_time = $3 AND status != 'cancelled'
    )
    ORDER BY t.capacity
  `, [party_size || 1, date, time]);
  res.json(result.rows);
});

// API: Create booking
app.post('/api/bookings', async (req, res) => {
  const { table_id, customer_name, customer_email, customer_phone, booking_date, booking_time, party_size, special_requests } = req.body;
  
  try {
    const result = await pool.query(`
      INSERT INTO bookings (table_id, customer_name, customer_email, customer_phone, booking_date, booking_time, party_size, special_requests)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [table_id, customer_name, customer_email, customer_phone, booking_date, booking_time, party_size, special_requests || '']);
    
    res.json({ id: result.rows[0].id, message: 'Booking confirmed!' });
  } catch (err) {
    res.status(400).json({ error: 'Error creating booking' });
  }
});

// API: Get all bookings
app.get('/api/bookings', async (req, res) => {
  const { date, status } = req.query;
  let query = `
    SELECT b.*, t.name as table_name, t.capacity, t.location
    FROM bookings b
    JOIN tables t ON b.table_id = t.id
    WHERE 1=1
  `;
  const params = [];
  
  if (date) {
    query += ` AND b.booking_date = $${params.length + 1}`;
    params.push(date);
  }
  if (status) {
    query += ` AND b.status = $${params.length + 1}`;
    params.push(status);
  }
  
  query += ' ORDER BY b.booking_date, b.booking_time';
  
  const result = await pool.query(query, params);
  res.json(result.rows);
});

// API: Update booking
app.patch('/api/bookings/:id', async (req, res) => {
  const { status } = req.body;
  await pool.query('UPDATE bookings SET status = $1 WHERE id = $2', [status, req.params.id]);
  res.json({ message: 'Booking updated' });
});

// API: Delete booking
app.delete('/api/bookings/:id', async (req, res) => {
  await pool.query('DELETE FROM bookings WHERE id = $1', [req.params.id]);
  res.json({ message: 'Booking deleted' });
});

// API: Stats
app.get('/api/stats', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  
  const totalTables = await pool.query('SELECT COUNT(*) FROM tables');
  const todayBookings = await pool.query('SELECT COUNT(*) FROM bookings WHERE booking_date = $1', [today]);
  const totalBookings = await pool.query('SELECT COUNT(*) FROM bookings');
  const pendingBookings = await pool.query("SELECT COUNT(*) FROM bookings WHERE status = 'pending'");
  
  res.json({
    totalTables: totalTables.rows[0].count,
    todayBookings: todayBookings.rows[0].count,
    totalBookings: totalBookings.rows[0].count,
    pendingBookings: pendingBookings.rows[0].count
  });
});

app.get('/', (req, res) => res.sendFile('public/index.html', { root: __dirname }));
app.get('/admin', (req, res) => res.sendFile('public/admin.html', { root: __dirname }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));