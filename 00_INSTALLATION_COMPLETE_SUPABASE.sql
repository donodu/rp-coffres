-- SILVER PHOENIX COMMAND CENTER — INSTALLATION COMPLÈTE DEPUIS ZÉRO
-- Ce script fonctionne sur un projet Supabase neuf ou sur une ancienne installation.
-- ATTENTION : il efface les anciennes données du site (profils applicatifs, coffres,
-- objets, stocks et historique), mais ne supprime pas les comptes Discord dans Auth.
-- Tous les membres commencent au grade « Recrue ». Aucun chef n'est nommé automatiquement.

begin;

create extension if not exists pgcrypto;

-- Supprime d'abord le déclencheur Auth, même si les anciennes tables ont disparu.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Nettoyage des anciennes politiques et du bucket d'images.
DROP POLICY IF EXISTS "object_images_read" ON storage.objects;
DROP POLICY IF EXISTS "object_images_insert" ON storage.objects;
DROP POLICY IF EXISTS "object_images_update" ON storage.objects;
DROP POLICY IF EXISTS "object_images_delete" ON storage.objects;
DROP POLICY IF EXISTS "Images objets lecture publique" ON storage.objects;
DROP POLICY IF EXISTS "Images objets ajout authentifie" ON storage.objects;
DROP POLICY IF EXISTS "Images objets suppression responsables" ON storage.objects;
-- Les fichiers Storage ne doivent pas être supprimés directement en SQL.
-- Le bucket est créé ou mis à jour plus bas avec ON CONFLICT.

-- Nettoyage de l'ancien schéma applicatif.
DROP TABLE IF EXISTS public.mission_members CASCADE;
DROP TABLE IF EXISTS public.missions CASCADE;
DROP TABLE IF EXISTS public.movements CASCADE;
DROP TABLE IF EXISTS public.inventory CASCADE;
DROP TABLE IF EXISTS public.items CASCADE;
DROP TABLE IF EXISTS public.vaults CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- Les types sont supprimés avec CASCADE afin de retirer proprement les anciennes
-- fonctions qui les utilisaient, même si l'installation était incomplète.
DROP TYPE IF EXISTS public.movement_type CASCADE;
DROP TYPE IF EXISTS public.vault_kind CASCADE;
DROP TYPE IF EXISTS public.sp_rank CASCADE;

-- Fonctions sans types personnalisés dans leur signature.
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP FUNCTION IF EXISTS public.set_updated_at();
DROP FUNCTION IF EXISTS public.current_rank_level();
DROP FUNCTION IF EXISTS public.is_top_three();
DROP FUNCTION IF EXISTS public.is_commander_supreme();
DROP FUNCTION IF EXISTS public.can_access_vault(uuid);
DROP FUNCTION IF EXISTS public.can_move_in_vault(uuid);
DROP FUNCTION IF EXISTS public.delete_item_completely(uuid);
DROP FUNCTION IF EXISTS public.create_personal_vault();
DROP FUNCTION IF EXISTS public.link_item_to_vault(uuid, uuid);

-- =========================================================
-- TYPES
-- =========================================================

CREATE TYPE public.sp_rank AS ENUM (
  'Commandeur suprême',
  'Maître de guerre',
  'Chef mercenaire',
  'Commandant',
  'Capitaine',
  'Chef d''escouade',
  'Spécialiste',
  'Élite',
  'Vétéran',
  'Soldat',
  'Mercenaire débutant',
  'Recrue'
);

CREATE TYPE public.vault_kind AS ENUM ('shared', 'personal');
CREATE TYPE public.movement_type AS ENUM ('deposit', 'withdrawal', 'adjustment');

-- =========================================================
-- TABLES
-- =========================================================

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  discord_id text UNIQUE,
  username text NOT NULL DEFAULT 'Utilisateur',
  display_name text,
  avatar_url text,
  rank public.sp_rank NOT NULL DEFAULT 'Recrue',
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.vaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  icon text,
  kind public.vault_kind NOT NULL DEFAULT 'shared',
  owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_archived boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vault_owner_kind_check CHECK (
    (kind = 'shared' AND owner_id IS NULL)
    OR
    (kind = 'personal' AND owner_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX vaults_shared_name_unique
  ON public.vaults (lower(name))
  WHERE kind = 'shared';

CREATE UNIQUE INDEX vaults_one_personal_per_owner
  ON public.vaults (owner_id)
  WHERE kind = 'personal';

CREATE TABLE public.items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL DEFAULT 'Divers',
  description text,
  unit text NOT NULL DEFAULT 'unité',
  image_url text,
  image_path text,
  is_archived boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, category)
);

CREATE TABLE public.inventory (
  vault_id uuid NOT NULL REFERENCES public.vaults(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  minimum_quantity integer NOT NULL DEFAULT 0 CHECK (minimum_quantity >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vault_id, item_id)
);

CREATE TABLE public.movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id uuid NOT NULL REFERENCES public.vaults(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  type public.movement_type NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  quantity_before integer NOT NULL CHECK (quantity_before >= 0),
  quantity_after integer NOT NULL CHECK (quantity_after >= 0),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX movements_created_at_idx ON public.movements (created_at DESC);
CREATE INDEX movements_user_id_idx ON public.movements (user_id);
CREATE INDEX movements_vault_id_idx ON public.movements (vault_id);
CREATE INDEX inventory_vault_id_idx ON public.inventory (vault_id);

-- =========================================================
-- OUTILS ET PERMISSIONS
-- =========================================================

CREATE OR REPLACE FUNCTION public.rank_level(target_rank public.sp_rank)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE target_rank
    WHEN 'Commandeur suprême' THEN 120
    WHEN 'Maître de guerre' THEN 110
    WHEN 'Chef mercenaire' THEN 100
    WHEN 'Commandant' THEN 90
    WHEN 'Capitaine' THEN 80
    WHEN 'Chef d''escouade' THEN 70
    WHEN 'Spécialiste' THEN 60
    WHEN 'Élite' THEN 50
    WHEN 'Vétéran' THEN 40
    WHEN 'Soldat' THEN 30
    WHEN 'Mercenaire débutant' THEN 20
    WHEN 'Recrue' THEN 10
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.current_rank_level()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.rank_level(p.rank), 0)
  FROM public.profiles p
  WHERE p.id = auth.uid() AND p.is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.is_top_three()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_rank_level() >= 100, false);
$$;

CREATE OR REPLACE FUNCTION public.is_commander_supreme()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_rank_level() = 120, false);
$$;

CREATE OR REPLACE FUNCTION public.can_access_vault(target_vault uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_rank_level() > 0 AND EXISTS (
    SELECT 1
    FROM public.vaults v
    WHERE v.id = target_vault
      AND v.is_archived = false
      AND (
        v.kind = 'shared'
        OR (v.kind = 'personal' AND public.is_top_three())
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_move_in_vault(target_vault uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.vaults v
    WHERE v.id = target_vault
      AND v.is_archived = false
      AND (
        (v.kind = 'shared' AND public.current_rank_level() >= 20)
        OR
        (v.kind = 'personal' AND public.is_top_three())
      )
  );
$$;

-- =========================================================
-- CRÉATION / MISE À JOUR DES PROFILS DISCORD
-- =========================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    discord_id,
    username,
    display_name,
    avatar_url,
    rank,
    last_seen_at
  )
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'provider_id', new.raw_user_meta_data->>'sub'),
    COALESCE(
      new.raw_user_meta_data->>'user_name',
      new.raw_user_meta_data->>'preferred_username',
      new.raw_user_meta_data->>'name',
      new.raw_user_meta_data->>'full_name',
      new.email,
      'Utilisateur'
    ),
    COALESCE(
      new.raw_user_meta_data->'custom_claims'->>'global_name',
      new.raw_user_meta_data->>'global_name',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name'
    ),
    new.raw_user_meta_data->>'avatar_url',
    'Recrue'::public.sp_rank,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    discord_id = COALESCE(EXCLUDED.discord_id, public.profiles.discord_id),
    username = EXCLUDED.username,
    display_name = COALESCE(EXCLUDED.display_name, public.profiles.display_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url),
    last_seen_at = now(),
    updated_at = now();

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT OR UPDATE OF raw_user_meta_data ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Recréation des profils correspondant aux comptes Discord déjà présents.
INSERT INTO public.profiles (
  id, discord_id, username, display_name, avatar_url, rank, last_seen_at
)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'provider_id', u.raw_user_meta_data->>'sub'),
  COALESCE(
    u.raw_user_meta_data->>'user_name',
    u.raw_user_meta_data->>'preferred_username',
    u.raw_user_meta_data->>'name',
    u.raw_user_meta_data->>'full_name',
    u.email,
    'Utilisateur'
  ),
  COALESCE(
    u.raw_user_meta_data->'custom_claims'->>'global_name',
    u.raw_user_meta_data->>'global_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name'
  ),
  u.raw_user_meta_data->>'avatar_url',
  'Recrue'::public.sp_rank,
  now()
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

-- =========================================================
-- MOUVEMENTS DE STOCK SÉCURISÉS
-- =========================================================

CREATE OR REPLACE FUNCTION public.move_stock(
  p_vault_id uuid,
  p_item_id uuid,
  p_type public.movement_type,
  p_quantity integer,
  p_reason text DEFAULT NULL
)
RETURNS public.movements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before integer;
  v_after integer;
  v_movement public.movements;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Connexion requise';
  END IF;

  IF NOT public.can_move_in_vault(p_vault_id) THEN
    RAISE EXCEPTION 'Permission insuffisante pour ce coffre';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'La quantité doit être supérieure à zéro';
  END IF;

  IF p_type = 'adjustment' AND NOT public.is_top_three() THEN
    RAISE EXCEPTION 'Seuls les trois plus hauts grades peuvent ajuster un stock';
  END IF;

  INSERT INTO public.inventory (vault_id, item_id, quantity)
  VALUES (p_vault_id, p_item_id, 0)
  ON CONFLICT (vault_id, item_id) DO NOTHING;

  SELECT quantity
  INTO v_before
  FROM public.inventory
  WHERE vault_id = p_vault_id AND item_id = p_item_id
  FOR UPDATE;

  IF p_type = 'deposit' THEN
    v_after := v_before + p_quantity;
  ELSIF p_type = 'withdrawal' THEN
    IF v_before < p_quantity THEN
      RAISE EXCEPTION 'Stock insuffisant';
    END IF;
    v_after := v_before - p_quantity;
  ELSIF p_type = 'adjustment' THEN
    v_after := p_quantity;
  ELSE
    RAISE EXCEPTION 'Type de mouvement invalide';
  END IF;

  UPDATE public.inventory
  SET quantity = v_after, updated_at = now()
  WHERE vault_id = p_vault_id AND item_id = p_item_id;

  INSERT INTO public.movements (
    vault_id, item_id, user_id, type, quantity,
    quantity_before, quantity_after, reason
  )
  VALUES (
    p_vault_id, p_item_id, auth.uid(), p_type, p_quantity,
    v_before, v_after, NULLIF(trim(p_reason), '')
  )
  RETURNING * INTO v_movement;

  RETURN v_movement;
END;
$$;

GRANT EXECUTE ON FUNCTION public.move_stock(uuid, uuid, public.movement_type, integer, text) TO authenticated;

-- Lie un objet à un coffre avec une quantité initiale de zéro.
CREATE OR REPLACE FUNCTION public.link_item_to_vault(
  p_vault_id uuid,
  p_item_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_top_three() THEN
    RAISE EXCEPTION 'Réservé aux trois plus hauts grades';
  END IF;

  IF NOT public.can_access_vault(p_vault_id) THEN
    RAISE EXCEPTION 'Coffre inaccessible';
  END IF;

  INSERT INTO public.inventory (vault_id, item_id, quantity)
  VALUES (p_vault_id, p_item_id, 0)
  ON CONFLICT (vault_id, item_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_item_to_vault(uuid, uuid) TO authenticated;

-- Crée le coffre personnel du haut gradé connecté.
CREATE OR REPLACE FUNCTION public.create_personal_vault()
RETURNS public.vaults
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles;
  v_vault public.vaults;
BEGIN
  IF NOT public.is_top_three() THEN
    RAISE EXCEPTION 'Réservé aux trois plus hauts grades';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = auth.uid();

  SELECT * INTO v_vault
  FROM public.vaults
  WHERE kind = 'personal' AND owner_id = auth.uid();

  IF v_vault.id IS NOT NULL THEN
    RETURN v_vault;
  END IF;

  INSERT INTO public.vaults (
    name, description, icon, kind, owner_id, created_by
  ) VALUES (
    'Coffre personnel — ' || COALESCE(v_profile.display_name, v_profile.username, 'Haut gradé'),
    'Coffre personnel réservé aux trois plus hauts grades.',
    'lock',
    'personal',
    auth.uid(),
    auth.uid()
  ) RETURNING * INTO v_vault;

  RETURN v_vault;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_personal_vault() TO authenticated;

-- Suppression définitive d'un objet, réservée au Commandeur suprême.
CREATE OR REPLACE FUNCTION public.delete_item_completely(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_commander_supreme() THEN
    RAISE EXCEPTION 'Seul le Commandeur suprême peut supprimer définitivement un objet';
  END IF;

  DELETE FROM public.items WHERE id = p_item_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_item_completely(uuid) TO authenticated;

-- =========================================================
-- updated_at
-- =========================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$;

CREATE TRIGGER profiles_set_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER vaults_set_updated_at
BEFORE UPDATE ON public.vaults
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER items_set_updated_at
BEFORE UPDATE ON public.items
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movements ENABLE ROW LEVEL SECURITY;

-- Profils
CREATE POLICY profiles_read_authenticated
ON public.profiles FOR SELECT TO authenticated
USING (public.current_rank_level() > 0);

-- Les changements de grade passent uniquement par une fonction sécurisée.
CREATE OR REPLACE FUNCTION public.set_member_access(
  p_user_id uuid,
  p_rank public.sp_rank,
  p_is_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_level integer;
  target_level integer;
BEGIN
  caller_level := public.current_rank_level();

  IF caller_level < 100 THEN
    RAISE EXCEPTION 'Réservé aux trois plus hauts grades';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Tu ne peux pas modifier ton propre grade depuis le site';
  END IF;

  SELECT public.rank_level(rank) INTO target_level
  FROM public.profiles
  WHERE id = p_user_id;

  IF target_level IS NULL THEN
    RAISE EXCEPTION 'Membre introuvable';
  END IF;

  IF target_level > caller_level OR public.rank_level(p_rank) > caller_level THEN
    RAISE EXCEPTION 'Tu ne peux pas gérer un grade supérieur au tien';
  END IF;

  UPDATE public.profiles
  SET rank = p_rank, is_active = p_is_active
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_member_access(uuid, public.sp_rank, boolean) TO authenticated;

-- Coffres : les coffres personnels n'apparaissent qu'aux trois plus hauts grades.
CREATE POLICY vaults_read_accessible
ON public.vaults FOR SELECT TO authenticated
USING (
  public.current_rank_level() > 0
  AND (kind = 'shared' OR (kind = 'personal' AND public.is_top_three()))
);

CREATE POLICY vaults_insert_top_three
ON public.vaults FOR INSERT TO authenticated
WITH CHECK (
  public.is_top_three()
  AND (
    (kind = 'shared' AND owner_id IS NULL)
    OR
    (kind = 'personal' AND owner_id = auth.uid())
  )
);

CREATE POLICY vaults_update_top_three
ON public.vaults FOR UPDATE TO authenticated
USING (public.is_top_three())
WITH CHECK (public.is_top_three());

CREATE POLICY vaults_delete_top_three
ON public.vaults FOR DELETE TO authenticated
USING (public.is_top_three());

-- Objets
CREATE POLICY items_read_authenticated
ON public.items FOR SELECT TO authenticated
USING (public.current_rank_level() > 0);

CREATE POLICY items_insert_top_three
ON public.items FOR INSERT TO authenticated
WITH CHECK (public.is_top_three());

CREATE POLICY items_update_top_three
ON public.items FOR UPDATE TO authenticated
USING (public.is_top_three())
WITH CHECK (public.is_top_three());

-- Pas de DELETE direct : suppression uniquement par la fonction sécurisée.

-- Inventaire
CREATE POLICY inventory_read_accessible
ON public.inventory FOR SELECT TO authenticated
USING (public.can_access_vault(vault_id));

-- Historique : visible uniquement par les trois plus hauts grades.
CREATE POLICY movements_read_top_three
ON public.movements FOR SELECT TO authenticated
USING (public.is_top_three());

-- =========================================================
-- STOCKAGE DES IMAGES
-- =========================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'object-images',
  'object-images',
  true,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY object_images_read
ON storage.objects FOR SELECT
USING (bucket_id = 'object-images');

CREATE POLICY object_images_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'object-images' AND public.is_top_three());

CREATE POLICY object_images_update
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'object-images' AND public.is_top_three())
WITH CHECK (bucket_id = 'object-images' AND public.is_top_three());

CREATE POLICY object_images_delete
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'object-images' AND public.is_top_three());

-- =========================================================
-- DROITS API
-- =========================================================

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.profiles, public.vaults, public.items, public.inventory, public.movements TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.vaults TO authenticated;
GRANT INSERT, UPDATE ON public.items TO authenticated;

-- =========================================================
-- COFFRES COMMUNS DE DÉPART
-- =========================================================

INSERT INTO public.vaults (name, description, icon, kind)
VALUES
  ('Armurerie', 'Armes et équipements de combat.', 'crosshair', 'shared'),
  ('Munitions', 'Réserves de munitions.', 'package', 'shared'),
  ('Médical', 'Médicaments et matériel de soin.', 'heart-pulse', 'shared'),
  ('Ravitaillement', 'Nourriture, eau et consommables.', 'utensils', 'shared'),
  ('Matériaux', 'Composants, pièces et ressources.', 'hammer', 'shared'),
  ('Équipement tactique', 'Protections et outils opérationnels.', 'shield', 'shared')
ON CONFLICT DO NOTHING;

commit;

-- =========================================================
-- APRÈS L’INSTALLATION
-- =========================================================
-- Tous les membres sont maintenant "Recrue".
-- Après que les membres concernés se sont connectés, attribue les vrais grades.
-- Exemple :
--
-- UPDATE public.profiles
-- SET rank = 'Commandeur suprême'
-- WHERE username = 'PSEUDO_DU_VRAI_CHEF';
--
-- UPDATE public.profiles
-- SET rank = 'Maître de guerre'
-- WHERE username = 'PSEUDO';
--
-- UPDATE public.profiles
-- SET rank = 'Chef mercenaire'
-- WHERE username = 'PSEUDO';
--
-- Les trois plus hauts grades sont les seuls à voir l'historique
-- et la section "Coffres personnels".
