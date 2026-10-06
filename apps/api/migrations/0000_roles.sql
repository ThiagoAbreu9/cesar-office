-- Bootstrap de infraestrutura (roda UMA vez, como superusuário/owner do banco).
-- A aplicação conecta com um usuário de login que é membro de `cesar_app`:
--   CREATE ROLE cesar_api LOGIN PASSWORD '...' IN ROLE cesar_app;
-- `cesar_app` não é dono de nenhuma tabela e não tem BYPASSRLS — por isso o RLS vale para ela.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cesar_app') THEN
    CREATE ROLE cesar_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
