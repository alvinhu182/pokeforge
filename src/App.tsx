/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { Sparkles, Loader2, Image as ImageIcon, Info, ChevronRight, Zap, Skull, Globe, Star, BookOpen, Hammer, Search, Trash2, HelpCircle, Download, Video } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence } from "motion/react";
import { toPng } from "html-to-image";

// --- Firebase ---
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, limit, getDocs, deleteDoc, doc, getDocFromServer, where, writeBatch } from "firebase/firestore";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from "firebase/auth";
import firebaseConfig from "../firebase-applet-config.json";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Types ---
interface FakemonStage {
  name: string;
  classification: string;
  typing: string;
  lore: string;
  imagePrompt: string;
  shinyImagePrompt?: string;
  imageUrl?: string;
  shinyImageUrl?: string;
  pokedexNumber?: number;
  suggestedBy?: string;
  stats: {
    hp: number;
    attack: number;
    defense: number;
    spAtk: number;
    spDef: number;
    speed: number;
  };
}

interface FakemonResult {
  evolutionLine: string;
  stages: FakemonStage[];
}

interface SavedFakemon extends FakemonStage {
  id: string;
  pokedexNumber: number;
  isShiny: boolean;
  isMega: boolean;
  rarity?: string;
  createdAt: any;
  userEmail: string;
  userId: string;
}

const CATEGORIES = ["Comum", "Raro", "Pseudo-Lendário", "Lendário", "Mítico", "Fóssil", "Ultra Beast", "Aleatório"];
const TYPES = [
  "Normal", "Fogo", "Água", "Grama", "Elétrico", "Gelo", "Lutador", "Veneno", "Terra", 
  "Voador", "Psíquico", "Inseto", "Pedra", "Fantasma", "Dragão", "Sombrio", "Aço", "Fada", "Cósmico", "Aleatório"
];
const CHARACTERISTICS = [
  { id: "none", label: "Nenhuma", icon: Globe },
  { id: "mega", label: "Mega Evolução", icon: Zap },
  { id: "regional", label: "Forma Regional", icon: Globe },
  { id: "corrupted", label: "Corrompido", icon: Skull },
  { id: "shiny", label: "Variante Brilhante", icon: Star },
  { id: "random", label: "Aleatório", icon: HelpCircle },
];

const TYPE_COLORS: Record<string, string> = {
  // Português
  "Normal": "#A8A77A",
  "Fogo": "#EE8130",
  "Água": "#6390F0",
  "Grama": "#7AC74C",
  "Elétrico": "#F7D02C",
  "Gelo": "#96D9D6",
  "Lutador": "#C22E28",
  "Veneno": "#A33EA1",
  "Terra": "#E2BF65",
  "Voador": "#A98FF3",
  "Psíquico": "#F95587",
  "Inseto": "#A6B91A",
  "Pedra": "#B6A136",
  "Fantasma": "#735797",
  "Dragão": "#6F35FC",
  "Sombrio": "#705746",
  "Aço": "#B7B7CE",
  "Fada": "#D685AD",
  "Cósmico": "#6842FF",
  "Estelar": "#4924A1",
  // English Fallbacks
  "Fire": "#EE8130",
  "Water": "#6390F0",
  "Grass": "#7AC74C",
  "Electric": "#F7D02C",
  "Ice": "#96D9D6",
  "Fighting": "#C22E28",
  "Poison": "#A33EA1",
  "Ground": "#E2BF65",
  "Flying": "#A98FF3",
  "Psychic": "#F95587",
  "Bug": "#A6B91A",
  "Rock": "#B6A136",
  "Ghost": "#735797",
  "Dragon": "#6F35FC",
  "Dark": "#705746",
  "Steel": "#B7B7CE",
  "Fairy": "#D685AD",
  "Cosmic": "#6842FF",
  "Stellar": "#4924A1",
};

export default function App() {
  const [view, setView] = useState<"forge" | "pokedex">("forge");
  const [user, setUser] = useState<User | null>(null);
  const [concept, setConcept] = useState("");
  const [suggestedBy, setSuggestedBy] = useState("");
  const [category, setCategory] = useState("Comum");
  const [type1, setType1] = useState("Normal");
  const [type2, setType2] = useState("Nenhum");
  const [evolutions, setEvolutions] = useState(1);
  const [characteristic, setCharacteristic] = useState("none");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FakemonResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pokedex, setPokedex] = useState<SavedFakemon[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [generatingVideoId, setGeneratingVideoId] = useState<string | null>(null);
  const [randomizing, setRandomizing] = useState<null | {
    category?: string;
    evolutions?: number;
    type1?: string;
    type2?: string;
    characteristic?: string;
  }>(null);

  const getTypeColor = (type: string) => {
    const t = type.trim();
    // Tenta encontrar a cor exata ou com a primeira letra maiúscula
    const normalized = t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    return TYPE_COLORS[normalized] || TYPE_COLORS[t] || "#000000";
  };

  // --- Firebase Auth ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error("Login error:", err);
    }
  };

  // --- Pokedex Sync ---
  useEffect(() => {
    if (!user) return;
    // Simplified query to avoid missing index errors
    const q = query(collection(db, "fakemons"), orderBy("pokedexNumber", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log(`Pokedex updated: ${snapshot.docs.length} items found.`);
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SavedFakemon));
      setPokedex(items);
    }, (err) => {
      console.error("Firestore error:", err);
    });
    return () => unsubscribe();
  }, [user]);

  // --- Connection Test ---
  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    };
    testConnection();
  }, []);

  const getNextPokedexNumber = async () => {
    const q = query(collection(db, "fakemons"), orderBy("pokedexNumber", "desc"), limit(1));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return 1;
    return snapshot.docs[0].data().pokedexNumber + 1;
  };

  const removeWhiteBackground = (base64: string): Promise<string> => {
    return new Promise((resolve) => {
      if (!base64 || !base64.startsWith('data:image')) {
        resolve(base64);
        return;
      }
      const img = new Image();
      img.src = base64;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(base64);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Threshold for "white"
        const threshold = 240;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i+1];
          const b = data[i+2];
          if (r > threshold && g > threshold && b > threshold) {
            data[i+3] = 0; // Set alpha to 0
          }
        }
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(base64);
    });
  };

  const getRarityStyles = (rarity: string = "Comum") => {
    const styles: Record<string, { border: string, glow: string, text: string, bg: string, accent: string }> = {
      "Comum": { 
        border: "12px solid black", 
        glow: "20px 20px 0px 0px rgba(0,0,0,1)", 
        text: "black", 
        bg: "white",
        accent: "black"
      },
      "Raro": { 
        border: "12px solid #3b82f6", 
        glow: "20px 20px 0px 0px rgba(59,130,246,0.5)", 
        text: "#1e40af", 
        bg: "#eff6ff",
        accent: "#3b82f6"
      },
      "Pseudo-Lendário": { 
        border: "12px solid #8b5cf6", 
        glow: "20px 20px 0px 0px rgba(139,92,246,0.5)", 
        text: "#5b21b6", 
        bg: "#f5f3ff",
        accent: "#8b5cf6"
      },
      "Lendário": { 
        border: "12px solid #f59e0b", 
        glow: "20px 20px 0px 0px rgba(245,158,11,0.5)", 
        text: "#92400e", 
        bg: "#fffbeb",
        accent: "#f59e0b"
      },
      "Mítico": { 
        border: "12px solid #ec4899", 
        glow: "20px 20px 0px 0px rgba(236,72,153,0.5)", 
        text: "#9d174d", 
        bg: "#fdf2f8",
        accent: "#ec4899"
      },
      "Fóssil": { 
        border: "12px solid #78350f", 
        glow: "20px 20px 0px 0px rgba(120,53,15,0.5)", 
        text: "#451a03", 
        bg: "#fff7ed",
        accent: "#78350f"
      },
      "Ultra Beast": { 
        border: "12px solid #10b981", 
        glow: "20px 20px 0px 0px rgba(16,185,129,0.5)", 
        text: "#065f46", 
        bg: "#ecfdf5",
        accent: "#10b981"
      }
    };
    return styles[rarity] || styles["Comum"];
  };

  const compressImage = (base64: string): Promise<string> => {
    return new Promise((resolve) => {
      if (!base64 || !base64.startsWith('data:image')) {
        resolve(base64);
        return;
      }
      const img = new Image();
      img.src = base64;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 768;
        let width = img.width;
        let height = img.height;

        if (width > MAX_WIDTH) {
          height = (MAX_WIDTH / width) * height;
          width = MAX_WIDTH;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          // Do NOT fill with white to preserve transparency
          ctx.drawImage(img, 0, 0, width, height);
        }
        // Use webp to preserve transparency and reduce size
        resolve(canvas.toDataURL("image/webp", 0.7));
      };
      img.onerror = () => resolve(base64);
    });
  };

  const reindexPokedex = async () => {
    if (!user) return;
    const path = "fakemons";
    try {
      const q = query(
        collection(db, path),
        where("userEmail", "==", user.email),
        orderBy("createdAt", "asc")
      );
      const snapshot = await getDocs(q);
      const docs = snapshot.docs;
      console.log(`Re-indexing ${docs.length} Fakemons for user: ${user.email}`);
      
      const nameToNumber = new Map<string, number>();
      let currentNum = 0;
      const batch = writeBatch(db);
      
      for (const docSnap of docs) {
        const data = docSnap.data();
        // Normalize name to handle Megas sharing numbers with their base
        const baseName = data.isMega ? data.name.replace(/^Mega\s+/i, "") : data.name;
        
        if (!nameToNumber.has(baseName)) {
          currentNum++;
          nameToNumber.set(baseName, currentNum);
        }
        
        batch.update(docSnap.ref, { pokedexNumber: nameToNumber.get(baseName) });
      }
      
      await batch.commit();
      console.log("Re-indexing complete.");
    } catch (err) {
      console.error("Re-indexing error:", err);
    }
  };

  const deleteFakemon = async (id: string | null) => {
    if (!id) return;
    console.log("Delete triggered for ID:", id);
    const path = "fakemons";
    try {
      await deleteDoc(doc(db, path, id));
      setDeleteConfirmId(null);
      // Trigger re-indexing after a short delay to ensure deletion propagation
      setTimeout(async () => {
        await reindexPokedex();
      }, 500);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `${path}/${id}`);
    }
  };

  const handleMigratePokedex = async () => {
    if (!user || pokedex.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      let count = 0;
      
      for (const fakemon of pokedex) {
        const updates: any = {};
        let changed = false;
        
        // 1. Fix Rarity
        if (!fakemon.rarity) {
          updates.rarity = "Comum";
          changed = true;
        }
        
        // 2. Fix Background (Transparent)
        // We check if it's likely a data URL and not already processed
        if (fakemon.imageUrl && fakemon.imageUrl.startsWith('data:image')) {
          const transparent = await removeWhiteBackground(fakemon.imageUrl);
          if (transparent !== fakemon.imageUrl) {
            updates.imageUrl = await compressImage(transparent);
            changed = true;
          }
        }
        
        if (changed) {
          const docRef = doc(db, "fakemons", fakemon.id);
          try {
            // Use a simple update call for each to avoid batch limits and handle heavy image data
            const batch = writeBatch(db);
            batch.update(docRef, updates);
            await batch.commit();
            count++;
          } catch (err) {
            console.error(`Error updating fakemon ${fakemon.id}:`, err);
          }
        }
      }
      
      if (count > 0) {
        alert(`${count} Fakemons atualizados e otimizados com sucesso!`);
      } else {
        alert("Sua Pokédex já está 100% otimizada!");
      }
    } catch (err) {
      console.error("Migration error:", err);
      setError("Erro ao migrar a Pokédex.");
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadCard = async (fakemon: SavedFakemon) => {
    setDownloadingId(fakemon.id);
    try {
      const rarityStyle = getRarityStyles(fakemon.rarity);
      const transparentUrl = await removeWhiteBackground(fakemon.imageUrl);
      
      // Create a temporary container for the card
      const container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.left = '-9999px';
      container.style.top = '0';
      document.body.appendChild(container);

      // Render the Super Trunfo card into the container
      const cardHtml = `
        <div id="super-trunfo-card" style="
          width: 400px;
          background: ${rarityStyle.bg};
          border: ${rarityStyle.border};
          padding: 20px;
          font-family: 'Inter', sans-serif;
          display: flex;
          flex-direction: column;
          gap: 20px;
          box-shadow: ${rarityStyle.glow};
        ">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 4px solid ${rarityStyle.accent}; padding-bottom: 10px;">
            <h1 style="margin: 0; font-size: 32px; font-weight: 900; text-transform: uppercase; font-style: italic; letter-spacing: -2px; color: ${rarityStyle.text};">${fakemon.name}</h1>
            <span style="font-weight: 900; font-size: 14px; background: ${rarityStyle.accent}; color: white; padding: 4px 8px;">#${String(fakemon.pokedexNumber).padStart(3, '0')}</span>
          </div>
          
          <div style="aspect-ratio: 1/1; border: 4px solid ${rarityStyle.accent}; background: rgba(0,0,0,0.03); overflow: hidden; display: flex; align-items: center; justify-content: center;">
            <img src="${transparentUrl}" style="width: 100%; height: 100%; object-fit: contain; padding: 20px;" />
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              ${fakemon.typing.split('/').map(t => `
                <span style="
                  background: ${getTypeColor(t)};
                  color: white;
                  padding: 4px 12px;
                  font-size: 12px;
                  font-weight: 900;
                  text-transform: uppercase;
                  border: 2px solid black;
                  box-shadow: 2px 2px 0px 0px rgba(0,0,0,1);
                ">${t.trim()}</span>
              `).join('')}
            </div>
            <span style="font-size: 10px; font-weight: 900; text-transform: uppercase; color: ${rarityStyle.accent}; opacity: 0.7;">${fakemon.rarity || "Comum"}</span>
          </div>

          <div style="background: ${rarityStyle.accent}; padding: 20px; border: 4px solid ${rarityStyle.accent}; display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <span style="color: rgba(255,255,255,0.5); font-size: 10px; font-weight: 900; text-transform: uppercase;">HP</span>
              <div style="height: 12px; background: rgba(255,255,255,0.1); position: relative; border: 1px solid rgba(255,255,255,0.2);">
                <div style="height: 100%; width: ${Math.min(100, (fakemon.stats.hp / 255) * 100)}%; background: #FF4B4B;"></div>
                <span style="position: absolute; right: 4px; top: -14px; color: white; font-size: 10px; font-weight: 900;">${fakemon.stats.hp}</span>
              </div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <span style="color: rgba(255,255,255,0.5); font-size: 10px; font-weight: 900; text-transform: uppercase;">ATK</span>
              <div style="height: 12px; background: rgba(255,255,255,0.1); position: relative; border: 1px solid rgba(255,255,255,0.2);">
                <div style="height: 100%; width: ${Math.min(100, (fakemon.stats.attack / 255) * 100)}%; background: #FF9F4B;"></div>
                <span style="position: absolute; right: 4px; top: -14px; color: white; font-size: 10px; font-weight: 900;">${fakemon.stats.attack}</span>
              </div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <span style="color: rgba(255,255,255,0.5); font-size: 10px; font-weight: 900; text-transform: uppercase;">DEF</span>
              <div style="height: 12px; background: rgba(255,255,255,0.1); position: relative; border: 1px solid rgba(255,255,255,0.2);">
                <div style="height: 100%; width: ${Math.min(100, (fakemon.stats.defense / 255) * 100)}%; background: #FFD94B;"></div>
                <span style="position: absolute; right: 4px; top: -14px; color: white; font-size: 10px; font-weight: 900;">${fakemon.stats.defense}</span>
              </div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <span style="color: rgba(255,255,255,0.5); font-size: 10px; font-weight: 900; text-transform: uppercase;">S.ATK</span>
              <div style="height: 12px; background: rgba(255,255,255,0.1); position: relative; border: 1px solid rgba(255,255,255,0.2);">
                <div style="height: 100%; width: ${Math.min(100, (fakemon.stats.spAtk / 255) * 100)}%; background: #4B7BFF;"></div>
                <span style="position: absolute; right: 4px; top: -14px; color: white; font-size: 10px; font-weight: 900;">${fakemon.stats.spAtk}</span>
              </div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <span style="color: rgba(255,255,255,0.5); font-size: 10px; font-weight: 900; text-transform: uppercase;">S.DEF</span>
              <div style="height: 12px; background: rgba(255,255,255,0.1); position: relative; border: 1px solid rgba(255,255,255,0.2);">
                <div style="height: 100%; width: ${Math.min(100, (fakemon.stats.spDef / 255) * 100)}%; background: #4BFF7B;"></div>
                <span style="position: absolute; right: 4px; top: -14px; color: white; font-size: 10px; font-weight: 900;">${fakemon.stats.spDef}</span>
              </div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <span style="color: rgba(255,255,255,0.5); font-size: 10px; font-weight: 900; text-transform: uppercase;">SPD</span>
              <div style="height: 12px; background: rgba(255,255,255,0.1); position: relative; border: 1px solid rgba(255,255,255,0.2);">
                <div style="height: 100%; width: ${Math.min(100, (fakemon.stats.speed / 255) * 100)}%; background: #FF4BFF;"></div>
                <span style="position: absolute; right: 4px; top: -14px; color: white; font-size: 10px; font-weight: 900;">${fakemon.stats.speed}</span>
              </div>
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: auto;">
            <span style="font-size: 8px; font-weight: 900; text-transform: uppercase; color: rgba(0,0,0,0.3);">PokéForge AI // Regional Card</span>
            ${fakemon.suggestedBy ? `<span style="font-size: 8px; font-weight: 900; text-transform: uppercase; color: rgba(0,0,0,0.6);">Sugestão: ${fakemon.suggestedBy}</span>` : ''}
          </div>
        </div>
      `;
      
      container.innerHTML = cardHtml;
      
      // Wait a bit for images to be ready
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const dataUrl = await toPng(container.querySelector('#super-trunfo-card') as HTMLElement, {
        quality: 1,
        pixelRatio: 2,
      });
      
      const link = document.createElement('a');
      link.download = `card-${fakemon.name.toLowerCase()}.png`;
      link.href = dataUrl;
      link.click();
      
      document.body.removeChild(container);
    } catch (err) {
      console.error("Error generating card:", err);
      setError("Erro ao gerar a imagem do card.");
    } finally {
      setDownloadingId(null);
    }
  };

  const handleGenerateAnimation = async (fakemon: SavedFakemon) => {
    setGeneratingVideoId(fakemon.id);
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    try {
      const rarityStyle = getRarityStyles(fakemon.rarity);
      
      // 1. Generate TTS Narration
      const ttsResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Narre com uma voz épica e misteriosa de Pokédex: ${fakemon.name}. ${fakemon.classification}. ${fakemon.lore}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Charon' },
            },
          },
        },
      });

      const base64Audio = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) throw new Error("Falha ao gerar narração.");

      // Decode TTS Audio (Raw PCM 16-bit Mono at 24000Hz)
      const audioData = atob(base64Audio);
      const audioArray = new Uint8Array(audioData.length);
      for (let i = 0; i < audioData.length; i++) {
        audioArray[i] = audioData.charCodeAt(i);
      }
      
      // Gemini TTS returns raw PCM 16-bit Mono at 24000Hz
      // Ensure buffer length is even for Int16Array
      const buffer = audioArray.length % 2 === 0 ? audioArray.buffer : audioArray.buffer.slice(0, -1);
      const pcmData = new Int16Array(buffer);
      const audioBuffer = audioCtx.createBuffer(1, pcmData.length, 24000);
      const nowBuffering = audioBuffer.getChannelData(0);
      for (let i = 0; i < pcmData.length; i++) {
        // Normalize 16-bit PCM to float [-1, 1]
        nowBuffering[i] = pcmData[i] / 32768;
      }

      const ttsSource = audioCtx.createBufferSource();
      ttsSource.buffer = audioBuffer;

      const destination = audioCtx.createMediaStreamDestination();
      ttsSource.connect(destination);

      // 2. Setup Canvas
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = 1080;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Load image and remove background on the fly
      const transparentUrl = await removeWhiteBackground(fakemon.imageUrl);
      const img = new Image();
      img.src = transparentUrl;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      // 3. Setup Recording
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') 
        ? 'video/webm;codecs=vp9,opus' 
        : 'video/webm';

      const canvasStream = canvas.captureStream(30);
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...destination.stream.getAudioTracks()
      ]);

      const recorder = new MediaRecorder(combinedStream, { mimeType });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fakemon-showcase-${fakemon.name.toLowerCase()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        setGeneratingVideoId(null);
        audioCtx.close();
      };

      // Start
      recorder.start();
      ttsSource.start(0);

      const startTime = performance.now();
      const duration = (audioBuffer.duration + 1) * 1000; // Match audio duration + padding

      // Particles
      const particles = Array.from({ length: 50 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 3 + 1,
        speed: Math.random() * 2 + 0.5,
        opacity: Math.random()
      }));

      const animate = (time: number) => {
        const elapsed = time - startTime;
        
        // Background
        const bgGradient = ctx.createRadialGradient(canvas.width/2, canvas.height/2, 0, canvas.width/2, canvas.height/2, 800);
        bgGradient.addColorStop(0, rarityStyle.bg === 'white' ? '#1a1a2e' : rarityStyle.bg);
        bgGradient.addColorStop(1, '#0a0a0a');
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Particles
        ctx.fillStyle = rarityStyle.accent;
        particles.forEach(p => {
          p.y -= p.speed;
          if (p.y < 0) p.y = canvas.height;
          ctx.globalAlpha = p.opacity * (0.5 + Math.sin(elapsed / 500) * 0.5);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;

        // "Life" Animation: Breathing & Floating
        const breathe = 1 + Math.sin(elapsed / 1000) * 0.03;
        const float = Math.sin(elapsed / 1500) * 20;
        
        // Glow behind
        ctx.shadowBlur = 50 + Math.sin(elapsed / 500) * 20;
        ctx.shadowColor = rarityStyle.accent;
        
        const imgSize = 750 * breathe;
        ctx.drawImage(
          img,
          (canvas.width - imgSize) / 2,
          (canvas.height - imgSize) / 2 - 100 + float,
          imgSize,
          imgSize
        );
        ctx.shadowBlur = 0;

        // UI Overlay
        ctx.strokeStyle = rarityStyle.accent;
        ctx.lineWidth = 4;
        ctx.strokeRect(50, 50, canvas.width - 100, canvas.height - 100);

        // Scanning line
        const scanY = (elapsed % 3000) / 3000 * canvas.height;
        const scanGrad = ctx.createLinearGradient(0, scanY - 50, 0, scanY + 50);
        scanGrad.addColorStop(0, 'transparent');
        scanGrad.addColorStop(0.5, `${rarityStyle.accent}33`); // 20% opacity
        scanGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = scanGrad;
        ctx.fillRect(50, scanY - 50, canvas.width - 100, 100);

        // Text
        ctx.textAlign = 'center';
        
        // Name
        ctx.fillStyle = rarityStyle.accent;
        ctx.font = 'black italic 100px Inter';
        ctx.fillText(fakemon.name.toUpperCase(), canvas.width / 2, 180);

        // Classification
        ctx.fillStyle = 'white';
        ctx.font = 'bold 30px Inter';
        ctx.fillText(fakemon.classification.toUpperCase(), canvas.width / 2, 230);

        // Lore (Typewriter effect or scrolling)
        ctx.font = '400 36px Inter';
        const words = fakemon.lore.split(' ');
        const maxWidth = 850;
        const lineHeight = 50;
        const lines = [];
        let currentLine = '';
        
        for(let n = 0; n < words.length; n++) {
          let testLine = currentLine + words[n] + ' ';
          if (ctx.measureText(testLine).width > maxWidth && n > 0) {
            lines.push(currentLine);
            currentLine = words[n] + ' ';
          } else {
            currentLine = testLine;
          }
        }
        lines.push(currentLine);

        const scrollOffset = (elapsed / duration) * (lines.length * lineHeight + 400);
        
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 780, canvas.width, 220);
        ctx.clip();
        
        lines.forEach((l, i) => {
          const y = 1000 + (i * lineHeight) - scrollOffset;
          ctx.fillText(l, canvas.width / 2, y);
        });
        ctx.restore();

        if (elapsed < duration) {
          requestAnimationFrame(animate);
        } else {
          recorder.stop();
        }
      };

      requestAnimationFrame(animate);
    } catch (err) {
      console.error("Error generating animation:", err);
      setError("Erro ao gerar a animação com narração.");
      setGeneratingVideoId(null);
      audioCtx.close();
    }
  };

  const withRetry = async <T extends unknown>(fn: () => Promise<T>, maxRetries = 3, initialDelay = 2000): Promise<T> => {
    let lastError: any;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        const isRateLimit = err?.message?.includes("429") || err?.status === "RESOURCE_EXHAUSTED" || (err?.code === 429);
        if (isRateLimit && i < maxRetries - 1) {
          const delay = initialDelay * Math.pow(2, i);
          console.warn(`Rate limit hit. Retrying in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  };

  const generateFakemon = async () => {
    if (!user) {
      setError("Você precisa estar logado para forjar Fakemon.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Handle Randomization
      let finalCategory = category;
      let finalEvolutions = evolutions;
      let finalType1 = type1;
      let finalType2 = type2;
      let finalCharacteristic = characteristic;

      const needsRandom = category === "Aleatório" || evolutions === 0 || type1 === "Aleatório" || type2 === "Aleatório" || characteristic === "random";

      if (needsRandom) {
        if (category === "Aleatório") {
          const cats = CATEGORIES.filter(c => c !== "Aleatório");
          finalCategory = cats[Math.floor(Math.random() * cats.length)];
        }
        if (evolutions === 0) {
          finalEvolutions = Math.floor(Math.random() * 3) + 1;
        }
        if (type1 === "Aleatório") {
          const ts = TYPES.filter(t => t !== "Aleatório");
          finalType1 = ts[Math.floor(Math.random() * ts.length)];
        }
        if (type2 === "Aleatório") {
          const ts = ["Nenhum", ...TYPES.filter(t => t !== "Aleatório")];
          finalType2 = ts[Math.floor(Math.random() * ts.length)];
        }
        if (characteristic === "random") {
          const chars = CHARACTERISTICS.filter(c => c.id !== "random");
          finalCharacteristic = chars[Math.floor(Math.random() * chars.length)].id;
        }

        setRandomizing({
          category: category === "Aleatório" ? finalCategory : undefined,
          evolutions: evolutions === 0 ? finalEvolutions : undefined,
          type1: type1 === "Aleatório" ? finalType1 : undefined,
          type2: type2 === "Aleatório" ? finalType2 : undefined,
          characteristic: characteristic === "random" ? CHARACTERISTICS.find(c => c.id === finalCharacteristic)?.label : undefined,
        });

        await new Promise(resolve => setTimeout(resolve, 6000));
        setRandomizing(null);
      }

      // 1. Generate Text Content for all stages
      const isMega = finalCharacteristic === "mega";
      const isShiny = finalCharacteristic === "shiny";
      const totalStages = isMega ? finalEvolutions + 1 : finalEvolutions;

      const textPrompt = `
        Você é um Especialista em Game Design e Artista Conceitual da franquia Fakemon.
        Crie uma linha evolutiva de Fakemon com base nestes parâmetros:
        - Conceito: ${concept || "Um Fakemon criativo, original e visualmente impactante"}
        - Categoria (Raridade/Poder): ${finalCategory}
          (Contexto de Categoria: 
          "Comum": Fakemon de rota inicial, poder moderado.
          "Raro": Fakemon com habilidades únicas, poder acima da média.
          "Pseudo-Lendário": Fakemon com 3 estágios e poder altíssimo.
          "Lendário": Fakemon único com grande poder e importância na lore.
          "Mítico": Fakemon extremamente raro e misterioso.
          "Fóssil": Fakemon pré-histórico ressuscitado.
          "Ultra Beast": Fakemon de outra dimensão com design bizarro e alienígena.)
        - Tipagem: ${finalType1}${finalType2 !== "Nenhum" ? ` / ${finalType2}` : ""}
        - Quantidade de estágios base: ${finalEvolutions}
        - Mega Evolução inclusa: ${isMega ? "Sim" : "Não"}
        - Variante Brilhante (Shiny) inclusa: ${isShiny ? "Sim" : "Não"}
        - Característica Especial: ${finalCharacteristic}

        Você deve gerar exatamente ${totalStages} Fakemon na linha evolutiva.
        ${isMega ? `O ÚLTIMO estágio (estágio ${totalStages}) DEVE ser a Mega Evolução do estágio anterior. O nome deve ser "Mega [Nome do Fakemon]".` : ""}
        
        Siga rigorosamente este formato JSON:
        {
          "evolutionLine": "Descrição geral da linha evolutiva",
          "stages": [
            {
              "name": "Nome do Fakemon",
              "classification": "Fakemon [Tipo de Criatura]",
              "typing": "Tipos",
              "lore": "Descrição detalhada (2-3 parágrafos) sobre comportamento, habitat e biologia.",
              "imagePrompt": "Prompt técnico e detalhado para gerador de imagem da versão NORMAL (estilo Ken Sugimori, ISOLADO EM FUNDO BRANCO PURO, detalhes nítidos, iluminação 3D moderna).",
              "shinyImagePrompt": "Prompt técnico e detalhado para gerador de imagem da versão BRILHANTE (SHINY). Descreva cores alternativas raras e contrastantes que fujam do padrão normal, mantendo o estilo visual, ISOLADO EM FUNDO BRANCO PURO.",
              "stats": {
                "hp": number,
                "attack": number,
                "defense": number,
                "spAtk": number,
                "spDef": number,
                "speed": number
              }
            }
          ]
        }
      `;

      const textResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [{ parts: [{ text: textPrompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              evolutionLine: { type: Type.STRING },
              stages: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    classification: { type: Type.STRING },
                    typing: { type: Type.STRING },
                    lore: { type: Type.STRING },
                    imagePrompt: { type: Type.STRING },
                    shinyImagePrompt: { type: Type.STRING },
                    stats: {
                      type: Type.OBJECT,
                      properties: {
                        hp: { type: Type.NUMBER },
                        attack: { type: Type.NUMBER },
                        defense: { type: Type.NUMBER },
                        spAtk: { type: Type.NUMBER },
                        spDef: { type: Type.NUMBER },
                        speed: { type: Type.NUMBER },
                      },
                      required: ["hp", "attack", "defense", "spAtk", "spDef", "speed"],
                    }
                  },
                  required: ["name", "classification", "typing", "lore", "imagePrompt", "shinyImagePrompt", "stats"],
                }
              }
            },
            required: ["evolutionLine", "stages"],
          },
        },
      }));

      const fakemonData = JSON.parse(textResponse.text || "{}") as FakemonResult;

      // 2. Generate Images and Save to Pokedex
      let currentPokedexNumber = await getNextPokedexNumber();
      
      const stagesWithImages = [];
      for (let index = 0; index < fakemonData.stages.length; index++) {
        const stage = fakemonData.stages[index];
        const isStageMega = isMega && index === fakemonData.stages.length - 1;
        
        // Assign number: Megas share number with previous stage
        const pokedexNumber = isStageMega ? currentPokedexNumber - 1 : currentPokedexNumber++;

        // Normal Image
        const normalImageResponse = await withRetry(() => ai.models.generateContent({
          model: "gemini-2.5-flash-image",
          contents: [{ parts: [{ text: stage.imagePrompt }] }],
          config: { imageConfig: { aspectRatio: "1:1" } },
        }));

        let imageUrl = "";
        for (const part of normalImageResponse.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
            imageUrl = `data:image/png;base64,${part.inlineData.data}`;
            break;
          }
        }

        // Compress images before saving to Firestore to avoid 1MB limit
        const transparentImageUrl = await removeWhiteBackground(imageUrl);
        const compressedImageUrl = await compressImage(transparentImageUrl);

        // Save Normal Version
        const normalDoc = {
          ...stage,
          imageUrl: compressedImageUrl,
          pokedexNumber,
          isShiny: false,
          isMega: isStageMega,
          rarity: finalCategory,
          suggestedBy: suggestedBy.trim(),
          createdAt: new Date(),
          userEmail: user.email,
          userId: user.uid
        };
        const path = "fakemons";
        try {
          await addDoc(collection(db, path), normalDoc);
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, path);
        }

        // Shiny Image
        let shinyImageUrl = "";
        if (isShiny && stage.shinyImagePrompt) {
          const shinyImageResponse = await withRetry(() => ai.models.generateContent({
            model: "gemini-2.5-flash-image",
            contents: [{ parts: [{ text: stage.shinyImagePrompt }] }],
            config: { imageConfig: { aspectRatio: "1:1" } },
          }));

          for (const part of shinyImageResponse.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) {
              shinyImageUrl = `data:image/png;base64,${part.inlineData.data}`;
              break;
            }
          }

          const transparentShinyImageUrl = await removeWhiteBackground(shinyImageUrl);
          const compressedShinyImageUrl = await compressImage(transparentShinyImageUrl);

          // Save Shiny Version as separate card
          const shinyDoc = {
            ...stage,
            imageUrl: compressedShinyImageUrl, // Use shiny image as main image for this card
            pokedexNumber,
            isShiny: true,
            isMega: isStageMega,
            rarity: finalCategory,
            suggestedBy: suggestedBy.trim(),
            createdAt: new Date(),
            userEmail: user.email,
            userId: user.uid
          };
          try {
            await addDoc(collection(db, path), shinyDoc);
          } catch (err) {
            handleFirestoreError(err, OperationType.CREATE, path);
          }
        }

        stagesWithImages.push({ ...stage, imageUrl, shinyImageUrl, pokedexNumber });
      }

      setResult({ ...fakemonData, stages: stagesWithImages as any });
    } catch (err: any) {
      console.error(err);
      if (err?.message?.includes("429") || err?.status === "RESOURCE_EXHAUSTED" || (err?.code === 429)) {
        setError("Limite de uso da IA atingido. Por favor, aguarde um momento antes de tentar novamente.");
      } else {
        setError("Ocorreu um erro ao forjar seu Fakemon. Tente novamente.");
      }
    } finally {
      setLoading(false);
    }
  };

  const StatBar = ({ label, value, color = "#00FF00" }: { label: string, value: number, color?: string }) => {
    const percentage = Math.min((value / 255) * 100, 100);
    const getStatName = (l: string) => {
      const names: Record<string, string> = {
        "HP": "HP",
        "ATK": "ATAQUE",
        "DEF": "DEFESA",
        "S.ATK": "ATK ESP",
        "S.DEF": "DEF ESP",
        "SPD": "VELOC"
      };
      return names[l] || l;
    };

    return (
      <div className="space-y-1">
        <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-white">
          <span className="opacity-80">{getStatName(label)}</span>
          <span style={{ color: color }}>{value}</span>
        </div>
        <div className="h-1.5 bg-white/10 border border-white/10 overflow-hidden rounded-none">
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            transition={{ duration: 1.5, ease: "circOut" }}
            className="h-full shadow-[0_0_8px_rgba(255,255,255,0.2)]"
            style={{ backgroundColor: color }}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#000000] font-sans selection:bg-[#00FF00] selection:text-[#000000]">
      {/* Header */}
      <header className="border-b-2 border-black p-4 md:p-6 flex flex-wrap justify-between items-center bg-[#FFFFFF] gap-4 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-black rounded-full flex items-center justify-center">
            <Zap className="text-[#00FF00] w-6 h-6" />
          </div>
          <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tighter italic">
            PokéForge <span className="text-[#00FF00] stroke-black stroke-1">v1.0</span>
          </h1>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          <button 
            onClick={() => setView("forge")}
            className={`flex items-center gap-2 px-4 py-2 font-black uppercase text-[10px] border-2 border-black transition-all ${view === "forge" ? "bg-black text-[#00FF00]" : "bg-white hover:bg-gray-100"}`}
          >
            <Hammer size={14} /> Forja
          </button>
          <button 
            onClick={() => setView("pokedex")}
            className={`flex items-center gap-2 px-4 py-2 font-black uppercase text-[10px] border-2 border-black transition-all ${view === "pokedex" ? "bg-black text-[#00FF00]" : "bg-white hover:bg-gray-100"}`}
          >
            <BookOpen size={14} /> Pokédex ({pokedex.length})
          </button>
          
          {user ? (
            <div className="flex items-center gap-2 ml-2">
              <img src={user.photoURL || ""} alt={user.displayName || ""} className="w-8 h-8 rounded-full border-2 border-black" />
              <button onClick={() => auth.signOut()} className="text-[8px] font-black uppercase opacity-50 hover:opacity-100">Sair</button>
            </div>
          ) : (
            <button onClick={login} className="bg-[#00FF00] text-black px-4 py-2 font-black uppercase text-[10px] border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all">
              Login
            </button>
          )}
        </div>
      </header>

      <main className="min-h-[calc(100vh-100px)]">
        {view === "forge" ? (
          <div className="grid grid-cols-1 lg:grid-cols-2">
            {/* Control Panel */}
            <section className="border-r-2 border-black p-6 md:p-10 space-y-8 overflow-y-auto max-h-[calc(100vh-100px)]">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-60 flex items-center gap-2">
                  <Info className="w-3 h-3" /> Conceito Base
                </label>
                <textarea
                  placeholder="Ex: Um lobo feito de cristais de gelo que vive em cavernas vulcânicas..."
                  className="w-full bg-[#F0F0F0] border-2 border-black p-4 font-medium focus:outline-none focus:ring-4 focus:ring-[#00FF00] transition-all resize-none h-32"
                  value={concept}
                  onChange={(e) => setConcept(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-60 flex items-center gap-2">
                  Sugerido por:
                </label>
                <input
                  type="text"
                  placeholder="Nome de quem sugeriu (opcional)"
                  className="w-full bg-[#F0F0F0] border-2 border-black p-3 font-bold focus:outline-none focus:ring-4 focus:ring-[#00FF00] transition-all"
                  value={suggestedBy}
                  onChange={(e) => setSuggestedBy(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-60">Categoria</label>
                  <select 
                    className="w-full bg-[#F0F0F0] border-2 border-black p-3 font-bold appearance-none focus:outline-none focus:ring-4 focus:ring-[#00FF00]"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-60">Evoluções</label>
                  <div className="flex border-2 border-black overflow-hidden">
                    {[0, 1, 2, 3].map(num => (
                      <button
                        key={num}
                        onClick={() => setEvolutions(num)}
                        className={`flex-1 p-3 font-bold transition-colors ${evolutions === num ? 'bg-black text-[#00FF00]' : 'bg-[#F0F0F0] hover:bg-[#E0E0E0]'}`}
                        title={num === 0 ? "Aleatório" : `${num} Estágio(s)`}
                      >
                        {num === 0 ? <HelpCircle className="w-4 h-4 mx-auto" /> : num}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-60">Tipo Primário</label>
                  <select 
                    className="w-full bg-[#F0F0F0] border-2 border-black p-3 font-bold appearance-none focus:outline-none focus:ring-4 focus:ring-[#00FF00]"
                    value={type1}
                    onChange={(e) => setType1(e.target.value)}
                  >
                    {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-60">Tipo Secundário</label>
                  <select 
                    className="w-full bg-[#F0F0F0] border-2 border-black p-3 font-bold appearance-none focus:outline-none focus:ring-4 focus:ring-[#00FF00]"
                    value={type2}
                    onChange={(e) => setType2(e.target.value)}
                  >
                    <option value="Nenhum">Nenhum</option>
                    {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-60">Característica Especial</label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {CHARACTERISTICS.map((char) => (
                    <button
                      key={char.id}
                      onClick={() => setCharacteristic(char.id)}
                      className={`flex flex-col items-center gap-2 p-4 border-2 border-black transition-all ${characteristic === char.id ? 'bg-[#00FF00] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] -translate-x-1 -translate-y-1' : 'bg-[#F0F0F0] hover:bg-[#E0E0E0]'}`}
                    >
                      <char.icon className="w-5 h-5" />
                      <span className="text-[10px] font-black uppercase">{char.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={generateFakemon}
                disabled={loading}
                className="w-full bg-black text-[#00FF00] p-6 font-black text-xl uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-[#1A1A1A] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    Forjando...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-6 h-6 group-hover:rotate-12 transition-transform" />
                    Forjar Fakemon
                  </>
                )}
              </button>

              {error && (
                <div className="p-4 bg-red-100 border-2 border-red-600 text-red-600 font-bold text-sm flex items-center gap-2">
                  <Skull className="w-4 h-4" /> {error}
                </div>
              )}
            </section>

            {/* Display Panel */}
            <section className="bg-[#F0F0F0] p-6 md:p-10 overflow-y-auto max-h-[calc(100vh-100px)] relative">
              <AnimatePresence mode="wait">
                {!result && !loading && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full flex flex-col items-center justify-center text-center space-y-6 opacity-30"
                  >
                    <div className="w-32 h-32 border-4 border-dashed border-black rounded-full flex items-center justify-center">
                      <ImageIcon className="w-12 h-12" />
                    </div>
                    <p className="font-black uppercase tracking-widest text-sm">Aguardando Parâmetros de Forja</p>
                  </motion.div>
                )}

                {loading && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="h-full flex flex-col items-center justify-center text-center space-y-8"
                  >
                    <div className="relative">
                      <div className="w-24 h-24 border-8 border-black border-t-[#00FF00] rounded-full animate-spin" />
                      <Zap className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 text-black animate-pulse" />
                    </div>
                    <div className="space-y-2">
                      <p className="font-black uppercase tracking-widest text-xl animate-pulse">Sincronizando com a Pokédex...</p>
                      <p className="text-xs font-mono opacity-50 italic">Gerando biologia e arte conceitual...</p>
                    </div>
                  </motion.div>
                )}

                {result && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-12 pb-10"
                  >
                    {/* Evolution Line Header */}
                    <div className="border-b-4 border-black pb-6">
                      <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-50 mb-2">Linha Evolutiva</p>
                      <h2 className="text-3xl font-black uppercase tracking-tighter italic leading-none">{result.evolutionLine}</h2>
                    </div>

                    {/* Stages List */}
                    <div className="space-y-20">
                      {result.stages.flatMap((stage, index) => {
                        const cards = [];
                        const isStageMega = characteristic === "mega" && index === result.stages.length - 1;
                        const rarityStyle = getRarityStyles(category === "Aleatório" ? "Comum" : category);
                        
                        // Normal Card
                        cards.push(
                          <div key={`${index}-normal`} className="space-y-8 p-6 border-4" style={{ backgroundColor: rarityStyle.bg, borderColor: rarityStyle.accent, boxShadow: `8px 8px 0px 0px ${rarityStyle.accent}` }}>
                            <div className="flex items-center gap-4">
                              <div className="text-white w-8 h-8 flex items-center justify-center font-black text-sm" style={{ backgroundColor: rarityStyle.accent }}>
                                {String(index + 1).padStart(2, '0')}
                              </div>
                              <div className="h-[2px] flex-1" style={{ backgroundColor: `${rarityStyle.accent}33` }} />
                              <div className="text-white px-3 py-1 text-[10px] font-black uppercase tracking-widest" style={{ backgroundColor: rarityStyle.accent }}>
                                {isStageMega ? "Mega Evolução" : "Forma Normal"}
                              </div>
                            </div>

                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
                              {/* Image & Stats Display */}
                              <div className="relative group">
                                <div className="relative aspect-square border-4 overflow-hidden z-10" style={{ backgroundColor: rarityStyle.bg, borderColor: rarityStyle.accent }}>
                                  {stage.imageUrl ? (
                                    <img 
                                      src={stage.imageUrl} 
                                      alt={stage.name} 
                                      className="w-full h-full object-contain p-4"
                                      referrerPolicy="no-referrer"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-gray-100">
                                      <ImageIcon className="w-12 h-12 opacity-20" />
                                    </div>
                                  )}
                                  <div className="absolute top-4 right-4 text-white px-3 py-1 text-[10px] font-black uppercase tracking-widest border-2" style={{ backgroundColor: rarityStyle.accent, borderColor: 'white' }}>
                                    {isStageMega ? "MEGA" : `ESTÁGIO ${index + 1}`}
                                  </div>
                                  {suggestedBy.trim() && (
                                    <div className="absolute bottom-4 left-4 bg-black/80 text-white px-2 py-1 text-[8px] font-black uppercase tracking-widest border border-white/20 backdrop-blur-sm">
                                      Sugerido por: {suggestedBy.trim()}
                                    </div>
                                  )}
                                </div>

                                {/* The "Black Part" - Stats Section */}
                                <div className="p-6 border-4 -mt-1 relative z-0 shadow-[8px_8px_0px_0px_rgba(0,0,0,0.2)]" style={{ backgroundColor: rarityStyle.accent, borderColor: rarityStyle.accent }}>
                                  <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                                    <StatBar label="HP" value={stage.stats.hp} color="white" />
                                    <StatBar label="ATK" value={stage.stats.attack} color="white" />
                                    <StatBar label="DEF" value={stage.stats.defense} color="white" />
                                    <StatBar label="S.ATK" value={stage.stats.spAtk} color="white" />
                                    <StatBar label="S.DEF" value={stage.stats.spDef} color="white" />
                                    <StatBar label="SPD" value={stage.stats.speed} color="white" />
                                  </div>
                                </div>
                              </div>

                              {/* Info Display */}
                              <div className="space-y-6">
                                <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 pb-4" style={{ borderColor: rarityStyle.accent }}>
                                  <div className="space-y-1">
                                    <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-50">REGISTRO #{String(stage.pokedexNumber || index + 1).padStart(3, '0')}</p>
                                    <h3 className="text-4xl md:text-5xl font-black uppercase tracking-tighter italic leading-none" style={{ color: rarityStyle.text }}>{stage.name}</h3>
                                  </div>
                                  <div className="flex gap-2">
                                    {stage.typing.split('/').map(t => (
                                      <span 
                                        key={t} 
                                        className="text-white px-3 py-1 text-[10px] font-black uppercase border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                                        style={{ backgroundColor: getTypeColor(t) }}
                                      >
                                        {t.trim()}
                                      </span>
                                    ))}
                                  </div>
                                </div>

                                <div className="space-y-4">
                                  <div className="space-y-1">
                                    <label className="text-[10px] font-black uppercase tracking-widest opacity-50">Classificação</label>
                                    <p className="font-bold text-base">{stage.classification.replace(/Pokémon/gi, "Fakemon")}</p>
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[10px] font-black uppercase tracking-widest opacity-50">Lore (Pokédex)</label>
                                    <div className="text-sm leading-relaxed prose prose-sm max-w-none prose-p:mb-4 prose-headings:font-black prose-headings:uppercase prose-headings:tracking-tighter">
                                      <ReactMarkdown>{stage.lore}</ReactMarkdown>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );

                        // Shiny Card
                        if (stage.shinyImageUrl) {
                          cards.push(
                            <div key={`${index}-shiny`} className="space-y-8 p-6 border-4" style={{ backgroundColor: rarityStyle.bg, borderColor: '#fbbf24', boxShadow: `8px 8px 0px 0px #fbbf24` }}>
                              <div className="flex items-center gap-4">
                                <div className="bg-yellow-400 text-black w-8 h-8 flex items-center justify-center font-black text-sm">
                                  <Star size={14} fill="currentColor" />
                                </div>
                                <div className="h-[2px] flex-1 bg-yellow-400/20" />
                                <div className="bg-yellow-400 text-black px-3 py-1 text-[10px] font-black uppercase tracking-widest">
                                  Variante Brilhante
                                </div>
                              </div>

                              <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
                                {/* Image & Stats Display */}
                                <div className="relative group">
                                  <div className="relative aspect-square border-4 overflow-hidden z-10" style={{ backgroundColor: rarityStyle.bg, borderColor: '#fbbf24' }}>
                                    <img 
                                      src={stage.shinyImageUrl} 
                                      alt={`${stage.name} Shiny`} 
                                      className="w-full h-full object-contain p-4"
                                      referrerPolicy="no-referrer"
                                    />
                                    <div className="absolute top-4 right-4 bg-yellow-400 text-black px-3 py-1 text-[10px] font-black uppercase tracking-widest border-2 border-black">
                                      SHINY
                                    </div>
                                    {suggestedBy.trim() && (
                                      <div className="absolute bottom-4 left-4 bg-black/80 text-white px-2 py-1 text-[8px] font-black uppercase tracking-widest border border-white/20 backdrop-blur-sm">
                                        Sugerido por: {suggestedBy.trim()}
                                      </div>
                                    )}
                                  </div>

                                  {/* The "Black Part" - Stats Section */}
                                  <div className="bg-black p-6 border-4 border-black -mt-1 relative z-0 shadow-[8px_8px_0px_0px_rgba(0,0,0,0.2)]">
                                    <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                                      <StatBar label="HP" value={stage.stats.hp} color="#FF4B4B" />
                                      <StatBar label="ATK" value={stage.stats.attack} color="#FF9F4B" />
                                      <StatBar label="DEF" value={stage.stats.defense} color="#FFD94B" />
                                      <StatBar label="S.ATK" value={stage.stats.spAtk} color="#4B7BFF" />
                                      <StatBar label="S.DEF" value={stage.stats.spDef} color="#4BFF7B" />
                                      <StatBar label="SPD" value={stage.stats.speed} color="#FF4BFF" />
                                    </div>
                                  </div>
                                </div>

                                {/* Info Display */}
                                <div className="space-y-6">
                                  <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-black pb-4">
                                    <div className="space-y-1">
                                      <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-50 text-yellow-600">REGISTRO RARO #{String(stage.pokedexNumber || index + 1).padStart(3, '0')}</p>
                                      <h3 className="text-4xl md:text-5xl font-black uppercase tracking-tighter italic leading-none">{stage.name} <span className="text-yellow-500">★</span></h3>
                                    </div>
                                    <div className="flex gap-2">
                                      {stage.typing.split('/').map(t => (
                                        <span 
                                          key={t} 
                                          className="text-white px-3 py-1 text-[10px] font-black uppercase border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                                          style={{ backgroundColor: getTypeColor(t) }}
                                        >
                                          {t.trim()}
                                        </span>
                                      ))}
                                    </div>
                                  </div>

                                  <div className="space-y-4">
                                    <div className="space-y-1">
                                      <label className="text-[10px] font-black uppercase tracking-widest opacity-50">Classificação</label>
                                      <p className="font-bold text-base">{stage.classification.replace(/Pokémon/gi, "Fakemon")}</p>
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[10px] font-black uppercase tracking-widest opacity-50">Lore (Pokédex)</label>
                                      <div className="text-sm leading-relaxed prose prose-sm max-w-none prose-p:mb-4 prose-headings:font-black prose-headings:uppercase prose-headings:tracking-tighter">
                                        <ReactMarkdown>{stage.lore}</ReactMarkdown>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        return cards;
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          </div>
        ) : (
          <section className="p-6 md:p-10 space-y-10 bg-[#F0F0F0] min-h-screen">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b-4 border-black pb-8">
              <div className="space-y-2">
                <h2 className="text-5xl font-black uppercase tracking-tighter italic leading-none">Pokédex Regional</h2>
                <p className="text-xs font-mono opacity-50 uppercase tracking-widest">Registros de todas as descobertas forjadas</p>
              </div>
              <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4 w-full md:w-auto">
                <div className="relative w-full md:w-96">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 opacity-30" size={18} />
                  <input 
                    type="text" 
                    placeholder="Buscar por nome ou tipo..." 
                    className="w-full bg-white border-2 border-black p-4 pl-12 font-bold focus:outline-none focus:ring-4 focus:ring-[#00FF00] transition-all"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <button
                  onClick={handleMigratePokedex}
                  disabled={loading}
                  className="bg-black text-[#00FF00] px-6 py-4 font-black uppercase text-[10px] border-2 border-black hover:bg-gray-900 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  title="Atualiza raridades e otimiza registros antigos"
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                  Otimizar Pokédex
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-8">
              {pokedex
                .filter(f => f.name.toLowerCase().includes(searchTerm.toLowerCase()) || f.typing.toLowerCase().includes(searchTerm.toLowerCase()))
                .map((fakemon) => {
                  const rarityStyle = getRarityStyles(fakemon.rarity);
                  return (
                    <motion.div 
                      layout
                      key={fakemon.id}
                      className="group relative border-4 transition-all"
                      style={{ 
                        backgroundColor: rarityStyle.bg,
                        borderColor: rarityStyle.accent,
                        boxShadow: `8px 8px 0px 0px ${rarityStyle.accent}`
                      }}
                    >
                      <div className="relative aspect-square border-b-4 overflow-hidden bg-gray-50/50" style={{ borderColor: rarityStyle.accent }}>
                        <img 
                          src={fakemon.imageUrl} 
                          alt={fakemon.name} 
                          className="w-full h-full object-contain p-6"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute top-4 left-4 text-white px-3 py-1 text-[10px] font-black uppercase tracking-widest" style={{ backgroundColor: rarityStyle.accent }}>
                          #{String(fakemon.pokedexNumber).padStart(3, '0')}
                        </div>
                        {fakemon.isShiny && (
                          <div className="absolute top-4 right-4 bg-yellow-400 text-black px-3 py-1 text-[10px] font-black uppercase tracking-widest flex items-center gap-1">
                            <Star size={10} fill="currentColor" /> Brilhante
                          </div>
                        )}
                        {fakemon.isMega && !fakemon.isShiny && (
                          <div className="absolute top-4 right-4 bg-purple-600 text-white px-3 py-1 text-[10px] font-black uppercase tracking-widest flex items-center gap-1">
                            <Zap size={10} fill="currentColor" /> Mega
                          </div>
                        )}
                        {fakemon.suggestedBy && (
                          <div className="absolute bottom-4 left-4 bg-black/80 text-white px-2 py-1 text-[8px] font-black uppercase tracking-widest border border-white/20 backdrop-blur-sm">
                            Sugerido por: {fakemon.suggestedBy}
                          </div>
                        )}
                      </div>
                      
                      <div className="p-6 space-y-4">
                        <div className="flex justify-between items-start gap-4">
                          <div>
                            <h3 className="text-2xl font-black uppercase tracking-tighter italic leading-none mb-1" style={{ color: rarityStyle.text }}>{fakemon.name}</h3>
                            <p className="text-[10px] font-bold opacity-50 uppercase tracking-widest">{fakemon.classification}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {fakemon.typing.split('/').map(t => (
                              <div 
                                key={t} 
                                className="px-2 py-0.5 text-[8px] font-black uppercase text-white border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                                style={{ backgroundColor: getTypeColor(t) }}
                              >
                                {t.trim()}
                              </div>
                            ))}
                          </div>
                        </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-black/5 p-2 text-center border border-black/10">
                        <p className="text-[7px] font-bold opacity-40 uppercase">HP</p>
                        <p className="text-[10px] font-black">{fakemon.stats.hp}</p>
                      </div>
                      <div className="bg-black/5 p-2 text-center border border-black/10">
                        <p className="text-[7px] font-bold opacity-40 uppercase">ATK</p>
                        <p className="text-[10px] font-black">{fakemon.stats.attack}</p>
                      </div>
                      <div className="bg-black/5 p-2 text-center border border-black/10">
                        <p className="text-[7px] font-bold opacity-40 uppercase">DEF</p>
                        <p className="text-[10px] font-black">{fakemon.stats.defense}</p>
                      </div>
                      <div className="bg-black/5 p-2 text-center border border-black/10">
                        <p className="text-[7px] font-bold opacity-40 uppercase">S.ATK</p>
                        <p className="text-[10px] font-black">{fakemon.stats.spAtk}</p>
                      </div>
                      <div className="bg-black/5 p-2 text-center border border-black/10">
                        <p className="text-[7px] font-bold opacity-40 uppercase">S.DEF</p>
                        <p className="text-[10px] font-black">{fakemon.stats.spDef}</p>
                      </div>
                      <div className="bg-black/5 p-2 text-center border border-black/10">
                        <p className="text-[7px] font-bold opacity-40 uppercase">SPD</p>
                        <p className="text-[10px] font-black">{fakemon.stats.speed}</p>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-black/10 flex justify-between items-center">
                      <button 
                        className="text-[10px] font-black uppercase tracking-widest hover:text-[#00FF00] transition-colors flex items-center gap-1"
                        onClick={() => {
                          setResult({ evolutionLine: "Registro da Pokédex", stages: [fakemon] });
                          setView("forge");
                        }}
                      >
                        Ver Detalhes <ChevronRight size={12} />
                      </button>
                      <button 
                        onClick={() => setDeleteConfirmId(fakemon.id)}
                        className="text-red-600 hover:bg-red-50 p-2 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                      <button 
                        onClick={() => handleDownloadCard(fakemon)}
                        disabled={downloadingId === fakemon.id}
                        className="text-blue-600 hover:bg-blue-50 p-2 transition-colors disabled:opacity-50"
                        title="Baixar Card Super Trunfo"
                      >
                        {downloadingId === fakemon.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                      </button>
                      <button 
                        onClick={() => handleGenerateAnimation(fakemon)}
                        disabled={generatingVideoId === fakemon.id}
                        className="text-purple-600 hover:bg-purple-50 p-2 transition-colors disabled:opacity-50"
                        title="Gerar Animação Pokédex"
                      >
                        {generatingVideoId === fakemon.id ? <Loader2 size={14} className="animate-spin" /> : <Video size={14} />}
                      </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            <AnimatePresence>
              {deleteConfirmId && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
                >
                  <motion.div 
                    initial={{ scale: 0.9, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    exit={{ scale: 0.9, y: 20 }}
                    className="bg-white border-4 border-black p-8 max-w-md w-full shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] space-y-6"
                  >
                    <div className="flex items-center gap-4 text-red-600">
                      <Trash2 size={32} />
                      <h3 className="text-2xl font-black uppercase tracking-tighter italic">Remover Registro?</h3>
                    </div>
                    <p className="font-bold text-gray-600 leading-relaxed">
                      Esta ação é irreversível. O Fakemon será removido permanentemente da sua Pokédex Regional.
                    </p>
                    <div className="flex gap-4 pt-4">
                      <button 
                        onClick={() => setDeleteConfirmId(null)}
                        className="flex-1 border-2 border-black p-3 font-black uppercase text-xs hover:bg-gray-100 transition-all"
                      >
                        Cancelar
                      </button>
                      <button 
                        onClick={() => deleteFakemon(deleteConfirmId)}
                        className="flex-1 bg-red-600 text-white border-2 border-black p-3 font-black uppercase text-xs shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all"
                      >
                        Confirmar
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {pokedex.length === 0 && (
              <div className="h-96 flex flex-col items-center justify-center text-center space-y-6 opacity-30">
                <BookOpen className="w-16 h-16" />
                <p className="font-black uppercase tracking-widest text-sm">Sua Pokédex está vazia. Comece a forjar!</p>
              </div>
            )}
          </section>
        )}

        {/* Randomization Overlay */}
        <AnimatePresence>
          {randomizing && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md"
            >
              <div className="max-w-2xl w-full space-y-8 text-center">
                <motion.div
                  initial={{ scale: 0.5, rotate: -10 }}
                  animate={{ scale: 1, rotate: 0 }}
                  className="inline-block bg-[#00FF00] text-black px-6 py-2 font-black uppercase italic text-xl border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"
                >
                  Sorteando Parâmetros...
                </motion.div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(randomizing).map(([key, value], idx) => value && (
                    <motion.div
                      key={key}
                      initial={{ x: -20, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      transition={{ delay: idx * 0.2 }}
                      className="bg-white/5 border-2 border-white/10 p-6 space-y-2"
                    >
                      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#00FF00]">
                        {key === 'category' ? 'Categoria' : 
                         key === 'evolutions' ? 'Evoluções' : 
                         key === 'type1' ? 'Tipo Primário' : 
                         key === 'type2' ? 'Tipo Secundário' : 'Característica'}
                      </p>
                      <motion.p 
                        initial={{ scale: 1.5, color: "#00FF00" }}
                        animate={{ scale: 1, color: "#FFFFFF" }}
                        className="text-2xl font-black uppercase italic"
                      >
                        {value}
                      </motion.p>
                    </motion.div>
                  ))}
                </div>

                <motion.div
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                  className="text-[10px] font-black uppercase tracking-[0.5em] text-white/40"
                >
                  Iniciando Forja em Instantes...
                </motion.div>

                <div className="w-full max-w-md mx-auto h-1 bg-white/10 overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 6, ease: "linear" }}
                    className="h-full bg-[#00FF00]"
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer / Status Bar */}
      <footer className="border-t-2 border-black p-4 bg-black text-[#00FF00] flex justify-between items-center text-[10px] font-mono uppercase tracking-widest">
        <div className="flex gap-6">
          <span className="flex items-center gap-2"><div className="w-2 h-2 bg-[#00FF00] rounded-full animate-pulse" /> System Online</span>
          <span className="hidden md:inline">Gemini 3.1 Pro // Active</span>
        </div>
        <div className="flex items-center gap-2">
          Made by PokéForge AI <ChevronRight className="w-3 h-3" />
        </div>
      </footer>
    </div>
  );
}
