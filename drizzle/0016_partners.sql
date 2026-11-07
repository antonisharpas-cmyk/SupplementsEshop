CREATE TABLE "partner_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"paid_on" date NOT NULL,
	"note" varchar(300),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "promo_codes" ADD COLUMN "partner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_partner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "partner_rate_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_payouts_user_idx" ON "partner_payouts" USING btree ("user_id","paid_on");--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_partner_user_id_users_id_fk" FOREIGN KEY ("partner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "promo_codes_partner_idx" ON "promo_codes" USING btree ("partner_user_id");