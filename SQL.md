-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.followers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  follower_id uuid NOT NULL,
  followed_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT followers_pkey PRIMARY KEY (id),
  CONSTRAINT followers_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES public.profiles(id),
  CONSTRAINT followers_followed_id_fkey FOREIGN KEY (followed_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.hashtags (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tag text NOT NULL UNIQUE,
  CONSTRAINT hashtags_pkey PRIMARY KEY (id)
);
CREATE TABLE public.places (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT places_pkey PRIMARY KEY (id)
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  username text UNIQUE,
  avatar_url text,
  reputation_score numeric DEFAULT 0,
  reputation_level text DEFAULT 'novato'::text,
  created_at timestamp with time zone DEFAULT now(),
  full_name text,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.review_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL,
  user_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT review_comments_pkey PRIMARY KEY (id),
  CONSTRAINT review_comments_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.reviews(id),
  CONSTRAINT review_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.review_hashtags (
  review_id uuid NOT NULL,
  hashtag_id uuid NOT NULL,
  CONSTRAINT review_hashtags_pkey PRIMARY KEY (review_id, hashtag_id),
  CONSTRAINT review_hashtags_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.reviews(id),
  CONSTRAINT review_hashtags_hashtag_id_fkey FOREIGN KEY (hashtag_id) REFERENCES public.hashtags(id)
);
CREATE TABLE public.review_images (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL,
  image_url text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT review_images_pkey PRIMARY KEY (id),
  CONSTRAINT review_images_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.reviews(id)
);
CREATE TABLE public.reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  place_id uuid NOT NULL,
  rating integer CHECK (rating >= 1 AND rating <= 5),
  content text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT reviews_pkey PRIMARY KEY (id),
  CONSTRAINT reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT reviews_place_id_fkey FOREIGN KEY (place_id) REFERENCES public.places(id)
);
CREATE TABLE public.votes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL,
  user_id uuid NOT NULL,
  type USER-DEFINED NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT votes_pkey PRIMARY KEY (id),
  CONSTRAINT votes_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.reviews(id),
  CONSTRAINT votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL,
  actor_id uuid,
  review_id uuid,
  comment_id uuid,
  vote_id uuid,
  type text NOT NULL CHECK (type IN ('comment', 'vote', 'follow')),
  message text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT notifications_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.reviews(id) ON DELETE SET NULL,
  CONSTRAINT notifications_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.review_comments(id) ON DELETE CASCADE,
  CONSTRAINT notifications_vote_id_fkey FOREIGN KEY (vote_id) REFERENCES public.votes(id) ON DELETE CASCADE
);

-- Enable row level security so each profile only reads its own feed.
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select_owner" ON public.notifications
  FOR SELECT
  USING (recipient_id = auth.uid());

CREATE POLICY "notifications_insert_service" ON public.notifications
  FOR INSERT
  WITH CHECK (auth.role() IN ('service_role', 'postgres'));

CREATE POLICY "notifications_update_owner" ON public.notifications
  FOR UPDATE
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

CREATE POLICY "notifications_delete_owner" ON public.notifications
  FOR DELETE
  USING (recipient_id = auth.uid());

/*
 Helper functions/triggers update the notifications feed automatically
 when a like or comment arrives. Since they run with SECURITY DEFINER and
 the insert policy allows the `postgres` role, we keep the frontend simple.
*/

CREATE OR REPLACE FUNCTION public.notifications_notify_comment() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  owner_id uuid;
  actor_username text;
  snippet text;
BEGIN
  SELECT user_id INTO owner_id FROM public.reviews WHERE id = NEW.review_id;
  IF owner_id IS NULL OR owner_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT username INTO actor_username FROM public.profiles WHERE id = NEW.user_id;
  snippet := substring(NEW.content FOR 120);

  INSERT INTO public.notifications (
    recipient_id,
    actor_id,
    review_id,
    comment_id,
    type,
    message,
    payload
  )
  VALUES (
    owner_id,
    NEW.user_id,
    NEW.review_id,
    NEW.id,
    'comment',
    format('%s comentó: %s', coalesce(format('@%s', actor_username), 'Alguien'), snippet),
    jsonb_build_object(
      'actor_username', actor_username,
      'comment_snippet', snippet,
      'review_id', NEW.review_id
    )
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER notifications_comment_insert
AFTER INSERT ON public.review_comments
FOR EACH ROW
EXECUTE FUNCTION public.notifications_notify_comment();

CREATE OR REPLACE FUNCTION public.notifications_notify_like() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  owner_id uuid;
  actor_username text;
BEGIN
  IF NEW.type <> 'like' THEN
    RETURN NEW;
  END IF;

  SELECT user_id INTO owner_id FROM public.reviews WHERE id = NEW.review_id;
  IF owner_id IS NULL OR owner_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT username INTO actor_username FROM public.profiles WHERE id = NEW.user_id;

  INSERT INTO public.notifications (
    recipient_id,
    actor_id,
    review_id,
    vote_id,
    type,
    message,
    payload
  )
  VALUES (
    owner_id,
    NEW.user_id,
    NEW.review_id,
    NEW.id,
    'vote',
    format('%s le dio like a tu reseña', coalesce(format('@%s', actor_username), 'Alguien')),
    jsonb_build_object(
      'actor_username', actor_username,
      'vote_type', NEW.type,
      'review_id', NEW.review_id
    )
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER notifications_vote_insert
AFTER INSERT ON public.votes
FOR EACH ROW
EXECUTE FUNCTION public.notifications_notify_like();

CREATE TRIGGER notifications_vote_update
AFTER UPDATE OF type ON public.votes
FOR EACH ROW
WHEN (NEW.type = 'like' AND OLD.type IS DISTINCT FROM 'like')
EXECUTE FUNCTION public.notifications_notify_like();
