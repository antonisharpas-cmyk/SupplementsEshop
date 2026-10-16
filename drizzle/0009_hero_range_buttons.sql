-- Custom SQL migration file, put your code below! --
-- The hero buttons now lead to the two ranges. Only changes the stock demo
-- buttons; anything the owner wrote in the admin is left alone.
UPDATE "hero_banners" SET
  "primary_cta_label" = '{"en":"Shop Sports Nutrition","el":"Αθλητική Διατροφή","ru":"Спортивное питание"}'::jsonb,
  "primary_cta_href" = '/sports-nutrition'
WHERE "primary_cta_label"->>'en' = 'Shop Protein';--> statement-breakpoint
UPDATE "hero_banners" SET
  "secondary_cta_label" = '{"en":"Shop Health & Wellness","el":"Υγεία & Ευεξία","ru":"Здоровье"}'::jsonb,
  "secondary_cta_href" = '/health-wellness'
WHERE "secondary_cta_label"->>'en' = 'Shop Creatine';
