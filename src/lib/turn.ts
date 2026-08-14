import { api } from './api';

class Turn {
  private _username: string | null = null;
  private _credential: string | null = null;
  private _expiration: number | null = null;

  async getServers(): Promise<RTCIceServer[]> {
    await this._getCredentials();
    
    // Use the hostname as the page is served from, identical to FileSync logic
    const host = window.location.hostname;
    
    return [
      { urls: `stun:${host}:3478` },
      {
        urls: [
          `turn:${host}:3478`,
          `turn:${host}:3478?transport=tcp`,
        ],
        username: this._username || undefined,
        credential: this._credential || undefined,
      },
    ];
  }

  private async _getCredentials(): Promise<{ username: string | null; credential: string | null }> {
    const now = Math.floor(Date.now() / 1000);

    // Check if token is still valid
    if (this._expiration !== null && this._expiration > now) {
      return { username: this._username, credential: this._credential };
    }

    try {
      // Fetch new token directly from the specified endpoint
      const response = await fetch(`https://filesync.app/api/credentials`, { method: "GET" });

      if (!response.ok) {
        throw new Error("An issue occurred while getting the token.");
      }

      // Parse the response as JSON
      const data = await response.json();

      // Get JWT from response
      const token = data.token;
      if (!token) throw new Error("Token cookie not found");

      // Decode JWT to get username and credential
      const payload = this._decodeJwt(token);

      // Set cached values
      this._username = payload.username;
      this._credential = payload.credential;
      this._expiration = payload.exp - 10; // Subtract 10 seconds for safety
      
      return { username: this._username, credential: this._credential };
    } catch (error) {
      console.error("Failed to fetch TURN credentials:", error);
      throw error;
    }
  }

  private _decodeJwt(token: string): any {
    try {
      const payload = token.split(".")[1];
      const json = atob(payload);
      return JSON.parse(json);
    } catch (error) {
      console.error("Failed to decode JWT token:", error);
      throw new Error("Invalid JWT token format");
    }
  }
}

export const turn = new Turn();
