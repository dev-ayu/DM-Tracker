import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Trash2, ExternalLink, Search, Users } from "lucide-react";
import { toast } from "sonner";
import CsvUpload from "@/components/CsvUpload";

type Contact = {
  id: string;
  full_name: string;
  username: string | null;
  profile_link: string;
  followers: number | null;
  biography: string | null;
  status: string;
  category: string | null;
};

const statusColors: Record<string, string> = {
  not_started: "text-muted-foreground",
  followed: "text-blue-500",
  dmed: "text-indigo-500",
  initiated: "text-purple-500",
  engaged: "text-orange-500",
  calendly_sent: "text-amber-500",
  booked: "text-emerald-500",
  flywheel: "text-red-500",
};

const statusLabel: Record<string, string> = {
  not_started: "New",
  followed: "Followed",
  dmed: "DM'd",
  initiated: "Initiated",
  engaged: "Engaged",
  calendly_sent: "Calendly",
  booked: "Booked",
  flywheel: "Flywheel",
};

const Contacts = ({ userId }: { userId: string }) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("contacts")
      .select("id, full_name, username, profile_link, followers, biography, status, category")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    setContacts(data || []);
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);

  const deleteContact = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}" permanently?`)) return;
    setContacts(prev => prev.filter(c => c.id !== id));
    toast.success("Contact deleted");
    await supabase.from("openers").delete().eq("contact_id", id);
    await supabase.from("daily_queues").delete().eq("contact_id", id);
    await supabase.from("contacts").delete().eq("id", id);
  };

  const filtered = useMemo(() =>
    contacts.filter(c =>
      c.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (c.username || "").toLowerCase().includes(search.toLowerCase()) ||
      (c.category || "").toLowerCase().includes(search.toLowerCase())
    ), [contacts, search]);

  return (
    <div className="h-[calc(100vh-5rem)] md:h-[calc(100vh-2rem)] overflow-y-auto overflow-x-hidden scrollbar-hide pb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">Contacts</h1>
          <span className="text-[11px] text-muted-foreground">{filtered.length}/{contacts.length}</span>
        </div>
        <CsvUpload userId={userId} onComplete={fetchContacts} />
      </div>

      {/* Search */}
      <div className="relative mb-2">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-8 pl-8 text-xs"
        />
      </div>

      {/* Contact list */}
      {loading ? (
        <p className="py-12 text-center text-muted-foreground text-xs">Loading...</p>
      ) : filtered.length === 0 ? (
        <div className="py-10 text-center">
          <Users className="h-6 w-6 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">
            {contacts.length === 0 ? "No contacts yet. Import a CSV to start." : "No contacts match your search."}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map(c => (
            <div key={c.id} className="rounded-lg border border-border bg-card px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 w-0">
                  <p className="text-sm font-medium leading-tight truncate">
                    {c.full_name}
                    <span className={`ml-1.5 text-[9px] font-semibold ${statusColors[c.status] || "text-muted-foreground"}`}>
                      {statusLabel[c.status] || c.status}
                    </span>
                  </p>
                  {c.username && <p className="text-[11px] text-muted-foreground leading-tight truncate">@{c.username}</p>}
                </div>
                <button
                  onClick={() => deleteContact(c.id, c.full_name)}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                {c.profile_link && (
                  <a href={c.profile_link} target="_blank" rel="noopener noreferrer"
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Contacts;
