// server.js - FINAL CORRECTED VERSION

const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const path = require('path');

// --- 1. SETUP ---
const app = express();
const port = 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// --- 2. FIREBASE INITIALIZATION ---
try {
    const serviceAccount = require('./service-account.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase Admin SDK connection successful.");
} catch (error) {
    console.error("CRITICAL ERROR: Could not initialize Firebase. Ensure 'service-account.json' is present. Details:", error);
    process.exit(1);
}
const db = admin.firestore();

// --- 3. SEATING CONFIGURATION & LOGIC ---
const SEAT_RANGES = { 'A': { 3: [31, 45], 4: [46, 60], 5: [61, 75], 6: [76, 90], 7: [91, 105], 8: [106, 120], 9: [121, 135], 10: [136, 150], 11: [151, 165], 12: [166, 180], 13: [181, 194], 14: [195, 208], 15: [208, 222], 16: [223, 235], 17: [236, 248], 18: [249, 262], 19: [263, 276], 20: [277, 290], 21: [291, 304], 22: [305, 318], 23: [319, 332], 24: [333, 344], 25: [345, 357], 26: [358, 370], 27: [371, 383], 28: [384, 396], 29: [397, 409], 30: [410, 422] }, 'B': { 3: [51, 75], 4: [76, 100], 5: [101, 125], 6: [126, 150], 7: [151, 175], 8: [176, 201], 9: [202, 227], 10: [228, 253], 11: [254, 279], 12: [280, 305], 13: [306, 331], 14: [332, 357], 15: [358, 377], 16: [378, 397], 17: [398, 417], 18: [418, 437], 19: [438, 457], 20: [458, 478], 21: [479, 499], 22: [500, 520], 23: [521, 548], 24: [549, 576], 25: [577, 604], 26: [605, 632], 27: [633, 661], 28: [662, 690], 29: [691, 719], 30: [720, 748] }, 'C': { 3: [29, 42], 4: [43, 56], 5: [57, 70], 6: [71, 84], 7: [85, 98], 8: [99, 112], 9: [113, 126], 10: [127, 140], 11: [141, 154], 12: [155, 168], 13: [169, 182], 14: [183, 196], 15: [197, 209], 16: [210, 221], 17: [222, 234], 18: [235, 247], 19: [248, 260], 20: [261, 273], 21: [274, 286], 22: [287, 299], 23: [300, 311], 24: [312, 322], 25: [323, 334], 26: [335, 347], 27: [348, 360], 28: [361, 373], 29: [374, 386], 30: [387, 399] } };
const RESERVED_SEATS = new Set(['B-25', 'A-30', 'A-75', 'C-71', 'A-105', 'C-113', 'A-150', 'C-141','A-194', 'C-183', 'A-222', 'C-235', 'A-262', 'B-478', 'A-304', 'C-287','A-332', 'C-312', 'B-577', 'C-335', 'A-383', 'B-690', 'A-409']);

// THIS FUNCTION MUST BE DEFINED *BEFORE* IT IS CALLED
function generateMasterSeatList() {
    const masterList = [];
    for (let rowNum = 3; rowNum <= 30; rowNum++) {
        for (const section of ['A', 'B', 'C']) {
            if (SEAT_RANGES[section][rowNum]) {
                const [start, end] = SEAT_RANGES[section][rowNum];
                for (let seatNum = start; seatNum <= end; seatNum++) {
                    const seatId = `${section}-${seatNum}`;
                    if (!RESERVED_SEATS.has(seatId)) {
                        masterList.push(seatId);
                    }
                }
            }
        }
    }
    return masterList;
}

// Now we can safely call the function and get the length
const MASTER_SEAT_LIST = generateMasterSeatList();
const TOTAL_AVAILABLE_SEATS = MASTER_SEAT_LIST.length;


// --- 4. API ROUTES ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/find-registration', async (req, res) => {
    const code = req.body.code;
    if (!code) return res.status(400).json({ message: "Code is required." });
    try {
        const query = await db.collection('registrations').where('registrationCode', '==', code).limit(1).get();
        if (query.empty) return res.status(404).json({ message: "Registration code not found." });
        const doc = query.docs[0];
        const data = doc.data();
        if (data.checkedIn) {
            return res.status(409).json({ message: `Code already used for ${data.sname}. Seats: ${data.seat1}, ${data.seat2}` });
        }
        res.status(200).json({ data, doc_id: doc.id });
    } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/check-in', async (req, res) => {
    const { doc_id } = req.body;
    if (!doc_id) return res.status(400).json({ message: "Document ID is required." });
    try {
        const studentDocRef = db.collection('registrations').doc(doc_id);
        const [seat1, seat2] = await db.runTransaction(async (t) => {
            const stateRef = db.collection('app_state').doc('seat_allocator');
            const stateDoc = await t.get(stateRef);
            const next_index = stateDoc.exists ? stateDoc.data().next_seat_index : 0;
            if (next_index + 1 >= TOTAL_AVAILABLE_SEATS) throw new Error("Auditorium is full.");
            
            const s1 = MASTER_SEAT_LIST[next_index];
            const s2 = MASTER_SEAT_LIST[next_index + 1];
            
            t.update(studentDocRef, { checkedIn: true, seat1: s1, seat2: s2, checkInTimestamp: admin.firestore.FieldValue.serverTimestamp() });
            t.set(stateRef, { next_seat_index: next_index + 2 });
            return [s1, s2];
        });
        res.status(200).json({ message: "Check-in successful!", seat1, seat2 });
    } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/get-seat-status', async (req, res) => {
    try {
        const snapshot = await db.collection('registrations').where('checkedIn', '==', true).get();
        const allocated_seats = [];
        snapshot.forEach(doc => {
            const d = doc.data();
            if (d.seat1) allocated_seats.push(d.seat1);
            if (d.seat2) allocated_seats.push(d.seat2);
        });
        const stateDoc = await db.collection('app_state').doc('seat_allocator').get();
        const allocated_count = stateDoc.exists ? stateDoc.data().next_seat_index : 0;
        res.status(200).json({ allocated_seats, allocated_count });
    } catch (error) { res.status(500).json({ message: error.message }); }
});

// --- 5. START THE SERVER ---
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
    console.log(`Generated master seat list with ${TOTAL_AVAILABLE_SEATS} available seats.`);
});