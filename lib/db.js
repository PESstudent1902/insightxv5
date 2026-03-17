'use strict';

const initSqlJs = require('sql.js');

/**
 * Builds and seeds the in-memory SQLite database with all mystery data.
 * @returns {Promise<import('sql.js').Database>}
 */
async function buildDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run(`
    CREATE TABLE flight_telemetry (
      time_utc      TEXT,
      altitude_ft   INTEGER,
      speed_kts     INTEGER,
      heading_deg   INTEGER,
      latitude      REAL,
      longitude     REAL,
      event         TEXT
    );
  `);

  db.run(`
    CREATE TABLE passenger_manifest (
      pax_id        TEXT PRIMARY KEY,
      last_name     TEXT,
      first_name    TEXT,
      nationality   TEXT,
      seat          TEXT,
      occupation    TEXT,
      checked_bags  INTEGER
    );
  `);

  db.run(`
    CREATE TABLE passport_database (
      pax_id            TEXT PRIMARY KEY,
      passport_number   TEXT,
      dob               TEXT,
      nationality       TEXT,
      japan_entries     INTEGER,
      last_japan_entry  TEXT,
      customs_notes     TEXT
    );
  `);

  db.run(`
    CREATE TABLE fuel_logs (
      time_utc          TEXT,
      fuel_remaining_kg INTEGER,
      consumption_rate  REAL,
      phase             TEXT,
      anomaly           TEXT
    );
  `);

  db.run(`
    CREATE TABLE atc_logs (
      time_utc  TEXT,
      type      TEXT,
      from_seat TEXT,
      content   TEXT
    );
  `);

  db.run(`
    CREATE TABLE insurance_claims (
      claim_id      TEXT PRIMARY KEY,
      claimant      TEXT,
      beneficiary   TEXT,
      policy_value  INTEGER,
      filed_date    TEXT,
      filed_time    TEXT,
      status        TEXT,
      notes         TEXT
    );
  `);

  db.run(`
    CREATE TABLE cargo_cctv (
      time_utc      TEXT,
      camera        TEXT,
      description   TEXT,
      container_id  TEXT
    );
  `);

  db.run(`
    CREATE TABLE medical_examiner (
      report_id       TEXT PRIMARY KEY,
      victim          TEXT,
      time_of_death   TEXT,
      cause           TEXT,
      toxin_detected  TEXT,
      dose_mg         REAL,
      route           TEXT,
      notes           TEXT
    );
  `);

  // ── Seed data ─────────────────────────────────────────────────────────────

  // Layer 1 — Flight Telemetry
  const telemetry = [
    ['2024-03-12 00:00:00', 0,     0,   270, 1.3521, 103.8198, 'Departure SIN'],
    ['2024-03-12 00:30:00', 18000, 420,  34, 5.1,    107.2,    null],
    ['2024-03-12 01:00:00', 32000, 480,  34, 8.6,    111.5,    null],
    ['2024-03-12 01:30:00', 35000, 490,  32, 12.1,   115.8,    null],
    ['2024-03-12 02:00:00', 35000, 490,  32, 16.4,   119.9,    null],
    ['2024-03-12 02:30:00', 35000, 490,  32, 20.6,   123.8,    null],
    ['2024-03-12 03:00:00', 35000, 490,  32, 24.8,   127.4,    null],
    ['2024-03-12 03:30:00', 35000, 490,  32, 28.9,   130.9,    null],
    ['2024-03-12 03:43:00', 35000, 490,  32, 30.2,   132.1,    'Cargo hold door sensor: OPEN'],
    ['2024-03-12 03:46:00', 35000, 490,  32, 30.6,   132.5,    'Cargo hold door sensor: CLOSED'],
    ['2024-03-12 04:00:00', 35000, 490,  32, 31.7,   133.6,    null],
    ['2024-03-12 04:30:00', 35000, 490,  32, 34.2,   136.1,    null],
    ['2024-03-12 05:00:00', 28000, 460,  32, 33.8,   138.7,    'Descent NRT'],
    ['2024-03-12 05:30:00', 10000, 300,  32, 35.2,   139.2,    null],
    ['2024-03-12 06:00:00', 0,     0,    32, 35.7694, 140.3929, 'Arrival NRT'],
  ];
  const telInsert = db.prepare(
    'INSERT INTO flight_telemetry VALUES (?,?,?,?,?,?,?)'
  );
  for (const row of telemetry) telInsert.run(row);
  telInsert.free();

  // Layer 2 — Passenger Manifest
  const passengers = [
    ['PAX001', 'Harman',  'Victor',    'British',  '1A', 'Investment Banker',    2],
    ['PAX002', 'Vasquez', 'Elena',     'Spanish',  '3B', 'Biochemist',           1],
    ['PAX003', 'Tanaka',  'Yuki',      'Japanese', '5C', 'Marine Biologist',     3],
    ['PAX004', 'Chen',    'Wei',       'Chinese',  '7D', 'Software Engineer',    1],
    ['PAX005', 'Okafor',  'Ngozi',     'Nigerian', '9E', 'Journalist',           2],
    ['PAX006', 'Laurent', 'Pierre',    'French',   '11A','Chef',                 2],
    ['PAX007', 'Kim',     'Soo-Jin',   'Korean',   '13C','Graduate Student',     1],
    ['PAX008', 'Santos',  'Isabella',  'Brazilian','15B','Fashion Designer',     2],
    ['PAX009', 'Petrov',  'Dmitri',    'Russian',  '17D','Retired',              1],
    ['PAX010', 'Ahmed',   'Fatima',    'Egyptian', '19A','Doctor',               1],
  ];
  const paxInsert = db.prepare(
    'INSERT INTO passenger_manifest VALUES (?,?,?,?,?,?,?)'
  );
  for (const row of passengers) paxInsert.run(row);
  paxInsert.free();

  // Layer 2B — Passport Database
  const passports = [
    ['PAX001', 'GB1234567', '1968-04-22', 'British',  0, null,
     'No issues'],
    ['PAX002', 'ES9876543', '1980-11-15', 'Spanish',  3, '2024-02-01',
     'Declared toxin-bearing biological specimens (fugu research) on 3 separate entries'],
    ['PAX003', 'JP5551234', '1990-07-30', 'Japanese', 12, '2024-03-01',
     'Frequent traveller; last entry: researcher import permit for puffer fish specimens (CONT-JP-007)'],
    ['PAX004', 'CN3344556', '1985-03-12', 'Chinese',  1, '2023-08-15',
     'No issues'],
    ['PAX005', 'NG2233445', '1975-09-05', 'Nigerian', 0, null,
     'No issues'],
    ['PAX006', 'FR9988776', '1972-06-20', 'French',   2, '2023-11-10',
     'No issues'],
    ['PAX007', 'KR1122334', '1998-01-08', 'Korean',   4, '2024-01-20',
     'No issues'],
    ['PAX008', 'BR6677889', '1992-12-03', 'Brazilian',0, null,
     'No issues'],
    ['PAX009', 'RU4455667', '1955-05-17', 'Russian',  1, '2023-06-01',
     'No issues'],
    ['PAX010', 'EG3322110', '1978-08-25', 'Egyptian', 0, null,
     'No issues'],
  ];
  const ppInsert = db.prepare(
    'INSERT INTO passport_database VALUES (?,?,?,?,?,?,?)'
  );
  for (const row of passports) ppInsert.run(row);
  ppInsert.free();

  // Layer 3 — Fuel Logs
  const fuel = [
    ['2024-03-12 00:00:00', 62000, 2.80, 'Taxi/Takeoff',  null],
    ['2024-03-12 01:00:00', 58400, 3.60, 'Climb',         null],
    ['2024-03-12 02:00:00', 54500, 3.90, 'Cruise',        null],
    ['2024-03-12 03:00:00', 50600, 3.90, 'Cruise',        null],
    ['2024-03-12 03:43:00', 48100, 3.90, 'Cruise',        'Momentary pressure drop – cargo hold door'],
    ['2024-03-12 04:00:00', 46700, 3.90, 'Cruise',        null],
    ['2024-03-12 05:00:00', 42800, 4.10, 'Descent',       null],
    ['2024-03-12 06:00:00', 39500, 0.00, 'Landed',        null],
  ];
  const fuelInsert = db.prepare(
    'INSERT INTO fuel_logs VALUES (?,?,?,?,?)'
  );
  for (const row of fuel) fuelInsert.run(row);
  fuelInsert.free();

  // Layer 4 — ATC Logs
  const atc = [
    ['2024-03-12 00:00:00', 'ATC',   null,  'F404, cleared for takeoff runway 02L'],
    ['2024-03-12 00:02:00', 'CREW',  null,  'F404 rolling'],
    ['2024-03-12 00:15:00', 'ATC',   null,  'F404, contact Singapore Radar 119.3'],
    ['2024-03-12 01:00:00', 'CREW',  null,  'Cruise altitude FL350'],
    ['2024-03-12 03:15:00', 'CABIN', null,  'Passenger call from Seat 1A — requested blanket'],
    ['2024-03-12 03:52:00', 'PHONE', '3B',  'Outbound call from Seat 3B: "Package has been delivered. Proceed as planned."'],
    ['2024-03-12 04:10:00', 'CABIN', null,  'Seat 1A passenger unresponsive — medical kit requested'],
    ['2024-03-12 04:12:00', 'CREW',  null,  'Mayday declared: passenger cardiac event'],
    ['2024-03-12 04:20:00', 'ATC',   null,  'F404, descend FL100, NRT priority handling'],
    ['2024-03-12 06:00:00', 'ATC',   null,  'F404, welcome to Narita'],
  ];
  const atcInsert = db.prepare(
    'INSERT INTO atc_logs VALUES (?,?,?,?)'
  );
  for (const row of atc) atcInsert.run(row);
  atcInsert.free();

  // Layer 5 — Insurance Claims
  const claims = [
    ['CLM-2024-001', 'Vasquez, Elena', 'Harman, Victor', 2000000,
     '2024-03-12', '14:37:00', 'Filed',
     'Life insurance policy #LI-GB-4821. Claimant listed as sole beneficiary. Filed same day as landing at NRT.'],
    ['CLM-2024-002', 'Tanaka, Yuki',   'Tanaka Research Fund', 45000,
     '2024-03-15', '09:10:00', 'Filed',
     'Cargo damage claim for biological specimens in CONT-JP-007. Partial container contents missing.'],
  ];
  const clmInsert = db.prepare(
    'INSERT INTO insurance_claims VALUES (?,?,?,?,?,?,?,?)'
  );
  for (const row of claims) clmInsert.run(row);
  clmInsert.free();

  // Layer 6 — Cargo CCTV
  const cctv = [
    ['2024-03-12 01:20:00', 'CAM-CARGO-1', 'Crew member performs routine cargo check', null],
    ['2024-03-12 03:40:00', 'CAM-CARGO-1', 'Aft stairwell door opens; passenger enters cargo hold',            null],
    ['2024-03-12 03:41:00', 'CAM-CARGO-2', 'Passenger (female, dark jacket) moves toward container rack C',   null],
    ['2024-03-12 03:43:00', 'CAM-CARGO-2', 'Passenger opens container CONT-JP-007; extracts small vial',       'CONT-JP-007'],
    ['2024-03-12 03:45:00', 'CAM-CARGO-2', 'Passenger closes CONT-JP-007 and moves toward stairwell',          'CONT-JP-007'],
    ['2024-03-12 03:46:00', 'CAM-CARGO-1', 'Passenger exits cargo hold; aft stairwell door closes',            null],
    ['2024-03-12 04:05:00', 'CAM-CARGO-1', 'No further activity in cargo hold', null],
  ];
  const cctvInsert = db.prepare(
    'INSERT INTO cargo_cctv VALUES (?,?,?,?)'
  );
  for (const row of cctv) cctvInsert.run(row);
  cctvInsert.free();

  // Layer 7 — Medical Examiner
  const medical = [
    ['ME-2024-F404-01', 'Harman, Victor (PAX001)', '2024-03-12 ~04:05 UTC',
     'Cardiorespiratory arrest', 'Tetrodotoxin (TTX)', 1.8, 'Oral ingestion',
     'Fatal dose confirmed. TTX consistent with puffer fish (Takifugu) origin. '
     + 'Victim consumed substance approx. 03:50-04:00 UTC based on symptom onset. '
     + 'No natural cardiac disease. Manner of death: Homicide.'],
  ];
  const medInsert = db.prepare(
    'INSERT INTO medical_examiner VALUES (?,?,?,?,?,?,?,?)'
  );
  for (const row of medical) medInsert.run(row);
  medInsert.free();

  return db;
}

module.exports = { buildDb };
