// Pegá acá la URL y la anon key de tu proyecto de Supabase
// (Project Settings → API, en el dashboard de supabase.com).
// La anon key es pública a propósito: los permisos reales los controla
// Row Level Security en la base (ver supabase-migration-multitenant.sql),
// no el secreto de esta key.
// Nunca pegues acá la service_role key.
//
// Esta base es multi-tenant: un mismo proyecto Supabase aloja varios
// edificios de varios clientes. Este archivo NO identifica qué edificio se
// muestra — eso lo resuelve index.html/admin.html por slug (?p=<slug> o el
// path), no una URL/key por edificio.

const SUPABASE_URL = "https://qfnmqcdtqilhbjddhcnh.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmbm1xY2R0cWlsaGJqZGRoY25oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNDY0MzEsImV4cCI6MjEwNDYyMjQzMX0.3BcLXtb85AhQ5M-ORLb83ZQfLJTgw-MPJmPb9x_-lBI";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
