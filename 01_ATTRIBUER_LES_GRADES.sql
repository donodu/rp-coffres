-- À utiliser APRÈS que les personnes se sont connectées une fois au site.
-- Remplace les pseudos entre apostrophes par les vrais pseudos Discord.

-- Voir les profils existants :
SELECT username, display_name, rank, is_active
FROM public.profiles
ORDER BY created_at;

-- Exemples d'attribution :
-- UPDATE public.profiles SET rank = 'Commandeur suprême' WHERE username = 'PSEUDO_DU_VRAI_CHEF';
-- UPDATE public.profiles SET rank = 'Maître de guerre' WHERE username = 'PSEUDO';
-- UPDATE public.profiles SET rank = 'Chef mercenaire' WHERE username = 'PSEUDO';
-- UPDATE public.profiles SET rank = 'Commandant' WHERE username = 'PSEUDO';
-- UPDATE public.profiles SET rank = 'Capitaine' WHERE username = 'PSEUDO';
-- UPDATE public.profiles SET rank = 'Chef d''escouade' WHERE username = 'PSEUDO';
-- UPDATE public.profiles SET rank = 'Spécialiste' WHERE username = 'PSEUDO';
-- UPDATE public.profiles SET rank = 'Élite' WHERE username = 'PSEUDO';
-- UPDATE public.profiles SET rank = 'Vétéran' WHERE username = 'PSEUDO';
-- UPDATE public.profiles SET rank = 'Soldat' WHERE username = 'PSEUDO';
-- UPDATE public.profiles SET rank = 'Mercenaire débutant' WHERE username = 'PSEUDO';
-- UPDATE public.profiles SET rank = 'Recrue' WHERE username = 'PSEUDO';
