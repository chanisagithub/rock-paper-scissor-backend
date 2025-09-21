import { Room, Client } from "colyseus";
import { Schema, type, MapSchema } from "@colyseus/schema";
import jwt from "jsonwebtoken";
import { PlayerSchema } from "../models/Player";

// Define the game state schema
class GameState extends Schema {
  @type("string") currentTurn: string = "";
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type("string") status: string = "waiting"; // waiting, playing, gameOver
  @type("string") winner: string | null = null;
  @type("string") player1Choice: string | null = null;
  @type("string") player2Choice: string | null = null;
  @type("number") player1Score: number = 0;
  @type("number") player2Score: number = 0;
  @type("number") round: number = 0;
  @type("number") maxRounds: number = 3;
}

interface JoinOptions {
  playerUuid: string;
  playerName: string;
  nftContractAddress?: string;
  nftTokenId?: string;
  nftImageUrl?: string;
}

export class DRPSRoom extends Room<GameState> {
  maxClients = 2;
  private gameTimeout: NodeJS.Timeout | null = null;
  private choiceTimeout: NodeJS.Timeout | null = null;

  onCreate(options: any) {
    this.setState(new GameState());
    console.log("DRPSRoom created!", options);

    this.onMessage("make_choice", (client, message) => {
      this.handlePlayerChoice(client, message.choice);
    });

    this.onMessage("rematch", (client) => {
      this.handleRematch(client);
    });
  }

  // Allow all connections without authentication
  onAuth(client: Client, options: JoinOptions) {
    console.log("Client authenticating:", client.sessionId, options.playerName);
    return true; // Always allow connection
  }

  // Remove authentication requirement - direct room access
  onJoin(client: Client, options: JoinOptions) {
    console.log(client.sessionId, "joined!", options.playerName);

    const player = new PlayerSchema();
    player.uuid = options.playerUuid;
    player.name = options.playerName;
    player.nftContractAddress = options.nftContractAddress;
    player.nftTokenId = options.nftTokenId;
    player.nftImageUrl = options.nftImageUrl;
    this.state.players.set(client.sessionId, player);

    if (this.clients.length === 2) {
      this.state.status = "playing";
      this.state.round = 1;
      this.broadcast("game_start", { message: "Game started! Make your choice." });
      this.startRound();
    } else {
      this.broadcast("waiting_for_opponent", { message: "Waiting for opponent..." });
    }
  }

  async onLeave(client: Client, consented: boolean) {
    console.log(client.sessionId, "left!");

    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.connected = false;
    }

    try {
      if (consented) {
        throw new Error("player consented to leave");
      }

      // Allow reconnection for 15 seconds
      await this.allowReconnection(client, 15);

      // If player successfully reconnected, set connected to true again.
      if (player) {
        player.connected = true;
      }

    } catch (e) {
      // 15 seconds expired. Forfeit the game.
      console.log(client.sessionId, "couldn't reconnect. Forfeiting game.");
      this.state.players.delete(client.sessionId);

      if (this.state.status === "playing") {
        // Find the remaining player from the state.players instead of this.clients
        const remainingPlayerSessionIds = Array.from(this.state.players.keys()).filter(id => id !== client.sessionId);
        this.state.winner = remainingPlayerSessionIds.length > 0 ? remainingPlayerSessionIds[0] : null;
        this.state.status = "gameOver";
        
        const winnerName = this.state.winner ? this.state.players.get(this.state.winner)?.name : "Unknown";
        this.broadcast("game_over", { 
          winner: this.state.winner, 
          message: `${player?.name} disconnected. ${winnerName} wins!` 
        });
        this.endGame();
      }
    }
  }

  onDispose() {
    console.log("Room disposed:", this.roomId);
    if (this.gameTimeout) clearTimeout(this.gameTimeout);
    if (this.choiceTimeout) clearTimeout(this.choiceTimeout);
    this.endGame(); // Ensure game results are sent even if room is disposed
  }

  private startRound() {
    // Safety check: ensure we have players before starting a round
    const playerSessionIds = Array.from(this.state.players.keys());
    if (playerSessionIds.length < 2) {
      console.log("Not enough players to start round, ending game");
      this.state.status = "gameOver";
      return;
    }

    this.state.player1Choice = null;
    this.state.player2Choice = null;
    this.state.currentTurn = playerSessionIds[0]; // Not strictly turn-based, but for tracking
    this.broadcast("round_start", { round: this.state.round, message: "Make your choice!" });

    // Set a timeout for players to make their choice (e.g., 10 seconds)
    this.choiceTimeout = setTimeout(() => {
      this.evaluateRound();
    }, 10000); // 10 seconds
  }

  private handlePlayerChoice(client: Client, choice: string) {
    if (this.state.status !== "playing") return;

    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const validChoices = ["rock", "paper", "scissors"];
    if (!validChoices.includes(choice)) {
      client.send("error", { message: "Invalid choice." });
      return;
    }

    if (client.sessionId === this.clients[0].sessionId) {
      this.state.player1Choice = choice;
    } else if (client.sessionId === this.clients[1].sessionId) {
      this.state.player2Choice = choice;
    }

    // Check if both players have made a choice
    if (this.state.player1Choice && this.state.player2Choice) {
      if (this.choiceTimeout) clearTimeout(this.choiceTimeout);
      this.evaluateRound();
    }
  }

  private evaluateRound() {
    // Safety check: ensure we have enough players before evaluating
    const playerSessionIds = Array.from(this.state.players.keys());
    if (playerSessionIds.length < 2) {
      console.log("Not enough players to evaluate round, ending game");
      this.state.status = "gameOver";
      return;
    }

    const p1Choice = this.state.player1Choice;
    const p2Choice = this.state.player2Choice;
    let roundWinner: string | null = null;
    let message: string = "";

    if (!p1Choice && !p2Choice) {
      message = "Both players failed to make a choice. Round is a draw.";
    } else if (!p1Choice) {
      const playerSessionIds = Array.from(this.state.players.keys());
      roundWinner = playerSessionIds[1]; // Second player wins
      this.state.player2Score++;
      message = `${this.state.players.get(playerSessionIds[0])?.name} failed to choose. ${this.state.players.get(roundWinner)?.name} wins the round!`;
    } else if (!p2Choice) {
      const playerSessionIds = Array.from(this.state.players.keys());
      roundWinner = playerSessionIds[0]; // First player wins
      this.state.player1Score++;
      message = `${this.state.players.get(playerSessionIds[1])?.name} failed to choose. ${this.state.players.get(roundWinner)?.name} wins the round!`;
    } else {
      // Both players made a choice, determine winner
      if (p1Choice === p2Choice) {
        message = `Both chose ${p1Choice}. It's a tie!`;
      } else if (
        (p1Choice === "rock" && p2Choice === "scissors") ||
        (p1Choice === "paper" && p2Choice === "rock") ||
        (p1Choice === "scissors" && p2Choice === "paper")
      ) {
        const playerSessionIds = Array.from(this.state.players.keys());
        roundWinner = playerSessionIds[0]; // First player wins
        this.state.player1Score++;
        message = `${this.state.players.get(roundWinner)?.name} wins the round!`;
      } else {
        const playerSessionIds = Array.from(this.state.players.keys());
        roundWinner = playerSessionIds[1]; // Second player wins
        this.state.player2Score++;
        message = `${this.state.players.get(roundWinner)?.name} wins the round!`;
      }
    }

    this.broadcast("round_end", {
      player1Choice: p1Choice,
      player2Choice: p2Choice,
      roundWinner: roundWinner,
      player1Score: this.state.player1Score,
      player2Score: this.state.player2Score,
      message: message,
    });

    this.state.round++;
    if (this.state.round > this.state.maxRounds || this.state.player1Score >= Math.ceil(this.state.maxRounds / 2) || this.state.player2Score >= Math.ceil(this.state.maxRounds / 2)) {
      this.checkWinCondition();
    } else {
      setTimeout(() => this.startRound(), 3000); // Small delay before next round
    }
  }

  private checkWinCondition() {
    // Get player session IDs from the state.players instead of relying on this.clients
    const playerSessionIds = Array.from(this.state.players.keys());
    
    if (playerSessionIds.length < 2) {
      console.error("Not enough players to determine winner");
      return;
    }

    let gameEndMessage = "";
    
    if (this.state.player1Score > this.state.player2Score) {
      this.state.winner = playerSessionIds[0]; // First player wins
      gameEndMessage = `${this.state.players.get(this.state.winner)?.name} wins the match!`;
    } else if (this.state.player2Score > this.state.player1Score) {
      this.state.winner = playerSessionIds[1]; // Second player wins
      gameEndMessage = `${this.state.players.get(this.state.winner)?.name} wins the match!`;
    } else {
      // It's a tie - no winner
      this.state.winner = null;
      gameEndMessage = `It's a tie! Both players scored ${this.state.player1Score}-${this.state.player2Score}!`;
    }

    this.state.status = "gameOver";
    this.broadcast("game_over", {
      winner: this.state.winner,
      message: gameEndMessage,
    });
    this.endGame();
  }

  private endGame() {
    if (this.gameTimeout) clearTimeout(this.gameTimeout);
    if (this.choiceTimeout) clearTimeout(this.choiceTimeout);

    // Submit game results to the Express API
    const winnerPlayer = this.state.players.get(this.state.winner!);
    const loserClient = this.clients.find(c => c.sessionId !== this.state.winner);
    const loserPlayer = loserClient ? this.state.players.get(loserClient.sessionId) : null;

    fetch(`http://localhost:${Number(process.env.PORT) + 1}/api/game-result`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionUuid: "dummy_session_id", // Replace with actual session ID from create-room
        winnerUuid: winnerPlayer?.uuid,
        loserUuid: loserPlayer?.uuid,
        finalScore: `${this.state.player1Score}-${this.state.player2Score}`,
      }),
    })
      .then(response => response.json())
      .then(data => console.log("Game result submitted:", data))
      .catch(error => console.error("Error submitting game result:", error));

    this.disconnect(); // Disconnect room after game ends
  }

  private handleRematch(client: Client) {
    // For minimalist approach, a rematch simply means returning to matchmaking
    // and creating a new room. The client will handle this by calling joinGame again.
    client.send("rematch_ack", { message: "Rematch requested. Returning to matchmaking." });
    this.disconnect();
  }
}

