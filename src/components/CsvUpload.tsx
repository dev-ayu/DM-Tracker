import { useCallback, useState, useRef } from "react";
import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

const contactSchema = z.object({
  user_id: z.string().uuid(),
  full_name: z.string().trim().min(1).max(200),
  username: z.string().trim().max(100),
  profile_link: z.string().trim().url().max(500),
  followers: z.number().int().min(0).max(1_000_000_000),
  biography: z.string().trim().max(2000),
  category: z.string().trim().max(100),
});

interface CsvUploadProps {
  userId: string;
  onComplete: () => void;
}

const CsvUpload = ({ userId, onComplete }: CsvUploadProps) => {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      setUploading(true);
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
          try {
            const rows = results.data as Record<string, string>[];

            let skippedInvalid = 0;
            const contacts = rows
              .map((row) => {
                const raw = {
                  user_id: userId,
                  full_name: row["Full name"] || row["full_name"] || row["Full Name"] || "",
                  username: row["Username"] || row["username"] || "",
                  profile_link: row["Profile link"] || row["profile_link"] || row["Profile Link"] || "",
                  followers: parseInt(row["Followers count"] || row["followers"] || row["Followers"] || "0") || 0,
                  biography: row["Biography"] || row["biography"] || "",
                  category: row["Category"] || row["category"] || "",
                };
                const result = contactSchema.safeParse(raw);
                if (!result.success) {
                  skippedInvalid++;
                  return null;
                }
                return result.data;
              })
              .filter((c): c is z.infer<typeof contactSchema> => c !== null && !!c.profile_link);

            if (!contacts.length) {
              toast.error("No valid contacts found in CSV");
              return;
            }

            const { data: existing } = await supabase
              .from("contacts")
              .select("profile_link")
              .eq("user_id", userId);

            const existingLinks = new Set((existing || []).map((c) => c.profile_link));
            const newContacts = contacts.filter((c) => !existingLinks.has(c.profile_link));
            const duplicateCount = contacts.length - newContacts.length;

            if (newContacts.length > 0) {
              for (let i = 0; i < newContacts.length; i += 50) {
                const batch = newContacts.slice(i, i + 50) as any[];
                const { error } = await supabase.from("contacts").insert(batch);
                if (error) throw error;
              }
            }

            toast.success(
              `Added ${newContacts.length} contacts${duplicateCount > 0 ? `, skipped ${duplicateCount} duplicates` : ""}`
            );
            onComplete();
          } catch (err: any) {
            toast.error(err.message || "Upload failed");
          } finally {
            setUploading(false);
          }
        },
        error: () => {
          toast.error("Failed to parse CSV");
          setUploading(false);
        },
      });
    },
    [userId, onComplete]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
      // Reset so same file can be re-selected
      if (e.target) e.target.value = "";
    },
    [processFile]
  );

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleFileInput}
        disabled={uploading}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
        className="h-8 gap-1.5"
      >
        <Upload className="h-3.5 w-3.5" />
        {uploading ? "Importing..." : "Import CSV"}
      </Button>
    </>
  );
};

export default CsvUpload;
