import { useState, useEffect, ReactNode } from "react";
import { authApi, AuthUser } from "@/lib/api/backend";
import { AuthContext } from "@/contexts/AuthContext";

type DirectVerifyResponse = {
  valid?: boolean;
  user?: AuthUser;
};

const AUTH_TOKEN_KEY = "bot_admin_token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!token) {
      setIsLoading(false);
      return;
    }

    const result = await authApi.verify();
    const directResult = result as DirectVerifyResponse;
    if (directResult.valid && directResult.user) {
      setUser(directResult.user);
    } else if (result.success && result.data?.valid && result.data.user) {
      setUser(result.data.user);
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
    setIsLoading(false);
  };

  const login = async (username: string, password: string): Promise<boolean> => {
    const result = await authApi.login(username, password);
    if (result.success && result.data) {
      localStorage.setItem(AUTH_TOKEN_KEY, result.data.token);
      setUser(result.data.user);
      return true;
    }
    return false;
  };

  const logout = async () => {
    await authApi.logout();
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
