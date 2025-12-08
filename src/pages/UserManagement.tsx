import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Trash2, UserPlus, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useUserRole } from "@/hooks/use-user-role";

interface UserWithRole {
  id: string;
  email: string;
  role: string;
  created_at: string;
}

const UserManagement = () => {
  const navigate = useNavigate();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"admin" | "gosc">("gosc");

  useEffect(() => {
    if (!roleLoading && !isAdmin) {
      toast.error("Brak dostępu do panelu administracyjnego");
      navigate("/dashboard");
      return;
    }

    if (isAdmin) {
      fetchUsers();
    }
  }, [isAdmin, roleLoading, navigate]);

  const fetchUsers = async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const response = await supabase.functions.invoke("get-users-with-emails", {
        headers: {
          Authorization: `Bearer ${sessionData.session?.access_token}`,
        },
      });

      if (response.error) throw response.error;
      if (response.data?.error) throw new Error(response.data.error);

      setUsers(response.data.users || []);
    } catch (error) {
      console.error("Error fetching users:", error);
      toast.error("Błąd podczas pobierania użytkowników");
    } finally {
      setLoading(false);
    }
  };

  const handleAddUser = async () => {
    if (!newUserEmail || !newUserPassword) {
      toast.error("Wypełnij wszystkie pola");
      return;
    }

    try {
      // Create user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: newUserEmail,
        password: newUserPassword,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
        },
      });

      if (authError) throw authError;

      if (authData.user) {
        // Update role (delete default 'gosc' role and add selected role)
        await supabase
          .from("user_roles")
          .delete()
          .eq("user_id", authData.user.id);

        const { error: roleError } = await supabase
          .from("user_roles")
          .insert({ user_id: authData.user.id, role: newUserRole });

        if (roleError) throw roleError;

        toast.success("Użytkownik został dodany");
        setNewUserEmail("");
        setNewUserPassword("");
        setNewUserRole("gosc");
        fetchUsers();
      }
    } catch (error: any) {
      console.error("Error adding user:", error);
      toast.error(error.message || "Błąd podczas dodawania użytkownika");
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm("Czy na pewno chcesz usunąć tego użytkownika?")) return;

    try {
      const { error } = await supabase.auth.admin.deleteUser(userId);
      if (error) throw error;

      toast.success("Użytkownik został usunięty");
      fetchUsers();
    } catch (error) {
      console.error("Error deleting user:", error);
      toast.error("Błąd podczas usuwania użytkownika");
    }
  };

  const handleChangeRole = async (userId: string, newRole: "admin" | "gosc") => {
    try {
      const { error } = await supabase
        .from("user_roles")
        .update({ role: newRole })
        .eq("user_id", userId);

      if (error) throw error;

      toast.success("Rola użytkownika została zmieniona");
      fetchUsers();
    } catch (error) {
      console.error("Error changing role:", error);
      toast.error("Błąd podczas zmiany roli");
    }
  };

  if (roleLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Zarządzanie użytkownikami</h1>
            <p className="text-muted-foreground">Dodawaj i zarządzaj użytkownikami systemu</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Dodaj nowego użytkownika
            </CardTitle>
            <CardDescription>Utwórz nowe konto użytkownika z wybraną rolą</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="user@example.com"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Hasło</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Rola</Label>
                <Select value={newUserRole} onValueChange={(value: "admin" | "gosc") => setNewUserRole(value)}>
                  <SelectTrigger id="role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gosc">Gość</SelectItem>
                    <SelectItem value="admin">Administrator</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button onClick={handleAddUser} className="w-full">
                  <UserPlus className="h-4 w-4 mr-2" />
                  Dodaj
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lista użytkowników</CardTitle>
            <CardDescription>Zarządzaj istniejącymi użytkownikami i ich rolami</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Rola</TableHead>
                  <TableHead>Data utworzenia</TableHead>
                  <TableHead className="text-right">Akcje</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.email}</TableCell>
                    <TableCell>
                      <Select
                        value={user.role}
                        onValueChange={(value: "admin" | "gosc") => handleChangeRole(user.id, value)}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="gosc">Gość</SelectItem>
                          <SelectItem value="admin">Administrator</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>{new Date(user.created_at).toLocaleDateString("pl-PL")}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteUser(user.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default UserManagement;
