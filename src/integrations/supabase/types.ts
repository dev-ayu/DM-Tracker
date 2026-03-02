export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      contacts: {
        Row: {
          a2_notes: string
          b_notes: string
          biography: string | null
          booked_at: string | null
          calendly_sent_at: string | null
          category: string | null
          created_at: string
          current_follow_up: string | null
          dm_skip_count: number
          dmed_at: string | null
          engaged_at: string | null
          flywheel_reason: string | null
          followed_at: string | null
          followed_back: boolean
          followed_back_at: string | null
          followers: number | null
          full_name: string
          id: string
          initiated_at: string | null
          last_follow_up_at: string | null
          media_seen: boolean
          media_seen_at: string | null
          negative_reply: boolean
          profile_link: string
          requeue_after: string | null
          status: string
          user_id: string
          username: string | null
        }
        Insert: {
          a2_notes?: string
          b_notes?: string
          biography?: string | null
          booked_at?: string | null
          calendly_sent_at?: string | null
          category?: string | null
          created_at?: string
          current_follow_up?: string | null
          dm_skip_count?: number
          dmed_at?: string | null
          engaged_at?: string | null
          flywheel_reason?: string | null
          followed_at?: string | null
          followed_back?: boolean
          followed_back_at?: string | null
          followers?: number | null
          full_name?: string
          id?: string
          initiated_at?: string | null
          last_follow_up_at?: string | null
          media_seen?: boolean
          media_seen_at?: string | null
          negative_reply?: boolean
          profile_link: string
          requeue_after?: string | null
          status?: string
          user_id: string
          username?: string | null
        }
        Update: {
          a2_notes?: string
          b_notes?: string
          biography?: string | null
          booked_at?: string | null
          calendly_sent_at?: string | null
          category?: string | null
          created_at?: string
          current_follow_up?: string | null
          dm_skip_count?: number
          dmed_at?: string | null
          engaged_at?: string | null
          flywheel_reason?: string | null
          followed_at?: string | null
          followed_back?: boolean
          followed_back_at?: string | null
          followers?: number | null
          full_name?: string
          id?: string
          initiated_at?: string | null
          last_follow_up_at?: string | null
          media_seen?: boolean
          media_seen_at?: string | null
          negative_reply?: boolean
          profile_link?: string
          requeue_after?: string | null
          status?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      daily_queues: {
        Row: {
          completed: boolean
          completed_at: string | null
          contact_id: string
          created_at: string
          id: string
          queue_date: string
          queue_type: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          contact_id: string
          created_at?: string
          id?: string
          queue_date?: string
          queue_type: string
          user_id: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          contact_id?: string
          created_at?: string
          id?: string
          queue_date?: string
          queue_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_queues_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_up_notes: {
        Row: {
          contact_id: string
          id: string
          note_number: number
          note_text: string
          stage: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          contact_id: string
          id?: string
          note_number: number
          note_text?: string
          stage: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          contact_id?: string
          id?: string
          note_number?: number
          note_text?: string
          stage?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_notes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      openers: {
        Row: {
          contact_id: string
          generated_at: string
          id: string
          opener_text: string
          user_id: string
        }
        Insert: {
          contact_id: string
          generated_at?: string
          id?: string
          opener_text: string
          user_id: string
        }
        Update: {
          contact_id?: string
          generated_at?: string
          id?: string
          opener_text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "openers_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
