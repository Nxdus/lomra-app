CREATE TABLE "saved_data" (
	"owner" text NOT NULL,
	"kind" text NOT NULL,
	"id" text NOT NULL,
	"value" jsonb NOT NULL,
	CONSTRAINT "saved_data_owner_kind_id_pk" PRIMARY KEY("owner","kind","id")
);
