// Pegá acá la URL y la anon key de tu proyecto de Supabase
// (Project Settings → API, en el dashboard de supabase.com).
// La anon key es pública a propósito: los permisos reales los controla
// Row Level Security en la base (ver supabase-schema.sql), no el secreto de esta key.
// Nunca pegues acá la service_role key.

const SUPABASE_URL = "https://qfnmqcdtqilhbjddhcnh.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmbm1xY2R0cWlsaGJqZGRoY25oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNDY0MzEsImV4cCI6MjEwNDYyMjQzMX0.3BcLXtb85AhQ5M-ORLb83ZQfLJTgw-MPJmPb9x_-lBI";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
