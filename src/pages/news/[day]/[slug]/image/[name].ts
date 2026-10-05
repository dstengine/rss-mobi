// GET /news/<day>/<slug>/image/<thumb.webp|card.webp|og.jpg> — the
// picture set by hand on a story whose sources are no posts of ours
// (StoryDoc.picture), resized on the way through like a post's. A story
// written from posts shows its post's picture from the post's own address
// instead (stories.ts storyPicture), and has nothing here.
import type { APIRoute } from "astro";
import { storyAt } from "../../../../../lib/stories.ts";
import { isSize, noPicture, pictureResponse, SIZES } from "../../../../../lib/pictures.ts";

export const GET: APIRoute = async ({ params, url, redirect }) => {
  const day = String(params.day ?? "");
  const slug = String(params.slug ?? "");
  const name = String(params.name ?? "");
  if (!/^\d{4}-\d\d-\d\d$/.test(day) || !/^[a-z0-9-]{1,100}$/.test(slug) || !isSize(name)) return noPicture(86_400);
  if (url.search) return redirect(`/news/${day}/${slug}/image/${name}`, 301);
  const story = await storyAt(day, slug);
  if (!story?.picture || story.picture.w < SIZES[name].min) return noPicture(3_600);
  return pictureResponse(story.picture.url, name);
};
