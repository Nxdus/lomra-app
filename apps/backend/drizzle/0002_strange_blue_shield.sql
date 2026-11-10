CREATE TABLE "saved_files" (
	"owner" text NOT NULL,
	"id" text NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "saved_files_owner_id_pk" PRIMARY KEY("owner","id")
);
