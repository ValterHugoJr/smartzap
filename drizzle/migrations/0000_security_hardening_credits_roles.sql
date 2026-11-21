REVOKE EXECUTE ON FUNCTION public.consume_ai_credit(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.topup_plan_credits(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.seed_fin_categorias(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_credit(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.topup_plan_credits(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.seed_fin_categorias(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.claim_super_admin_if_empty()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE _email text; _exists boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'super_admin'::public.app_role) INTO _exists;
  IF _exists THEN RETURN; END IF;
  SELECT email INTO _email FROM auth.users WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL;
  IF _email IS NULL THEN RETURN; END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (auth.uid(), 'super_admin'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO public.app_config (id, super_admin_emails) VALUES (true, ARRAY[_email])
  ON CONFLICT (id) DO UPDATE SET super_admin_emails = (
      SELECT ARRAY(SELECT DISTINCT unnest(public.app_config.super_admin_emails || ARRAY[_email]))), updated_at = now();
END $function$;

CREATE OR REPLACE FUNCTION public.tg_company_protect_billing()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.is_super_admin() THEN RETURN NEW; END IF;
  IF NEW.status_cobranca IS DISTINCT FROM OLD.status_cobranca
     OR NEW.trial_ate IS DISTINCT FROM OLD.trial_ate
     OR NEW.creditos_saldo IS DISTINCT FROM OLD.creditos_saldo
     OR NEW.creditos_origem IS DISTINCT FROM OLD.creditos_origem
     OR NEW.creditos_resetam_em IS DISTINCT FROM OLD.creditos_resetam_em THEN
    RAISE EXCEPTION 'Campos de cobrança não podem ser alterados';
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_company_protect_billing ON public.company;
CREATE TRIGGER trg_company_protect_billing BEFORE UPDATE ON public.company
FOR EACH ROW EXECUTE FUNCTION public.tg_company_protect_billing();