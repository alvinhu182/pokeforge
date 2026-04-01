/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { GoogleGenAI, Type } from "@google/genai";
import { Sparkles, Loader2, Image as ImageIcon, Info, ChevronRight, Zap, Skull, Globe, Star, BookOpen, Hammer, Search, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence } from "motion/react";

// --- Firebase ---
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, limit, getDocs, deleteDoc, doc, getDocFromServer, where, writeBatch } from "firebase/firestore";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from "firebase/auth";
import firebaseConfig from "../firebase-applet-config.json";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

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
  createdAt: any;
  userEmail: string;
  userId: string;
}

const CATEGORIES = ["Comum", "Raro", "Pseudo-Lendário", "Lendário", "Mítico", "Fóssil", "Ultra Beast"];
const TYPES = [
  "Normal", "Fogo", "Água", "Grama", "Elétrico", "Gelo", "Lutador", "Veneno", "Terra", 
  "Voador", "Psíquico", "Inseto", "Pedra", "Fantasma", "Dragão", "Sombrio", "Aço", "Fada", "Cósmico"
];
const CHARACTERISTICS = [
  { id: "none", label: "Nenhuma", icon: Globe },
  { id: "mega", label: "Mega Evolução", icon: Zap },
  { id: "regional", label: "Forma Regional", icon: Globe },
  { id: "corrupted", label: "Corrompido", icon: Skull },
  { id: "shiny", label: "Variante Brilhante", icon: Star },
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
    const q = query(collection(db, "fakemons"), orderBy("pokedexNumber", "asc"), orderBy("createdAt", "desc"));
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

  const compressImage = (base64: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64;
      img.crossOrigin = "anonymous";
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
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
        }
        // Using jpeg with 0.7 quality to significantly reduce size (usually < 100KB)
        resolve(canvas.toDataURL("image/jpeg", 0.7));
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
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      
      // 1. Generate Text Content for all stages
      const isMega = characteristic === "mega";
      const isShiny = characteristic === "shiny";
      const totalStages = isMega ? evolutions + 1 : evolutions;

      const textPrompt = `
        Você é um Especialista em Game Design e Artista Conceitual da franquia Fakemon.
        Crie uma linha evolutiva de Fakemon com base nestes parâmetros:
        - Conceito: ${concept || "Um Fakemon criativo, original e visualmente impactante"}
        - Categoria (Raridade/Poder): ${category}
          (Contexto de Categoria: 
          "Comum": Fakemon de rota inicial, poder moderado.
          "Raro": Fakemon com habilidades únicas, poder acima da média.
          "Pseudo-Lendário": Fakemon com 3 estágios e poder altíssimo.
          "Lendário": Fakemon único com grande poder e importância na lore.
          "Mítico": Fakemon extremamente raro e misterioso.
          "Fóssil": Fakemon pré-histórico ressuscitado.
          "Ultra Beast": Fakemon de outra dimensão com design bizarro e alienígena.)
        - Tipagem: ${type1}${type2 !== "Nenhum" ? ` / ${type2}` : ""}
        - Quantidade de estágios base: ${evolutions}
        - Mega Evolução inclusa: ${isMega ? "Sim" : "Não"}
        - Variante Brilhante (Shiny) inclusa: ${isShiny ? "Sim" : "Não"}
        - Característica Especial: ${characteristic}

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
              "imagePrompt": "Prompt técnico e detalhado para gerador de imagem da versão NORMAL (estilo Ken Sugimori, fundo branco, detalhes nítidos, iluminação 3D moderna).",
              "shinyImagePrompt": "Prompt técnico e detalhado para gerador de imagem da versão BRILHANTE (SHINY). Descreva cores alternativas raras e contrastantes que fujam do padrão normal, mantendo o estilo visual.",
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
        const compressedImageUrl = await compressImage(imageUrl);

        // Save Normal Version
        const normalDoc = {
          ...stage,
          imageUrl: compressedImageUrl,
          pokedexNumber,
          isShiny: false,
          isMega: isStageMega,
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

          const compressedShinyImageUrl = await compressImage(shinyImageUrl);

          // Save Shiny Version as separate card
          const shinyDoc = {
            ...stage,
            imageUrl: compressedShinyImageUrl, // Use shiny image as main image for this card
            pokedexNumber,
            isShiny: true,
            isMega: isStageMega,
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
                    {[1, 2, 3].map(num => (
                      <button
                        key={num}
                        onClick={() => setEvolutions(num)}
                        className={`flex-1 p-3 font-bold transition-colors ${evolutions === num ? 'bg-black text-[#00FF00]' : 'bg-[#F0F0F0] hover:bg-[#E0E0E0]'}`}
                      >
                        {num}
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
                        
                        // Normal Card
                        cards.push(
                          <div key={`${index}-normal`} className="space-y-8">
                            <div className="flex items-center gap-4">
                              <div className="bg-black text-[#00FF00] w-8 h-8 flex items-center justify-center font-black text-sm">
                                {String(index + 1).padStart(2, '0')}
                              </div>
                              <div className="h-[2px] flex-1 bg-black/10" />
                              <div className="bg-black text-white px-3 py-1 text-[10px] font-black uppercase tracking-widest">
                                {isStageMega ? "Mega Evolução" : "Forma Normal"}
                              </div>
                            </div>

                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
                              {/* Image & Stats Display */}
                              <div className="relative group">
                                <div className="relative aspect-square bg-white border-4 border-black overflow-hidden z-10">
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
                                  <div className="absolute top-4 right-4 bg-black text-[#00FF00] px-3 py-1 text-[10px] font-black uppercase tracking-widest border-2 border-[#00FF00]">
                                    {isStageMega ? "MEGA" : `ESTÁGIO ${index + 1}`}
                                  </div>
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
                                    <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-50">REGISTRO #{String(stage.pokedexNumber || index + 1).padStart(3, '0')}</p>
                                    <h3 className="text-4xl md:text-5xl font-black uppercase tracking-tighter italic leading-none">{stage.name}</h3>
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
                            <div key={`${index}-shiny`} className="space-y-8">
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
                                  <div className="relative aspect-square bg-white border-4 border-yellow-400 overflow-hidden z-10">
                                    <img 
                                      src={stage.shinyImageUrl} 
                                      alt={`${stage.name} Shiny`} 
                                      className="w-full h-full object-contain p-4"
                                      referrerPolicy="no-referrer"
                                    />
                                    <div className="absolute top-4 right-4 bg-yellow-400 text-black px-3 py-1 text-[10px] font-black uppercase tracking-widest border-2 border-black">
                                      SHINY
                                    </div>
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
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-8">
              {pokedex
                .filter(f => f.name.toLowerCase().includes(searchTerm.toLowerCase()) || f.typing.toLowerCase().includes(searchTerm.toLowerCase()))
                .map((fakemon) => (
                <motion.div 
                  layout
                  key={fakemon.id}
                  className="group relative bg-white border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:-translate-x-1 hover:-translate-y-1 hover:shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] transition-all"
                >
                  <div className="relative aspect-square border-b-4 border-black overflow-hidden bg-gray-50">
                    <img 
                      src={fakemon.imageUrl} 
                      alt={fakemon.name} 
                      className="w-full h-full object-contain p-6"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute top-4 left-4 bg-black text-white px-3 py-1 text-[10px] font-black uppercase tracking-widest">
                      #{String(fakemon.pokedexNumber).padStart(3, '0')}
                    </div>
                    {fakemon.isShiny && (
                      <div className="absolute top-4 right-4 bg-yellow-400 text-black px-3 py-1 text-[10px] font-black uppercase tracking-widest flex items-center gap-1">
                        <Star size={10} fill="currentColor" /> Brilhante
                      </div>
                    )}
                    {fakemon.isMega && (
                      <div className="absolute top-4 right-4 bg-purple-600 text-white px-3 py-1 text-[10px] font-black uppercase tracking-widest flex items-center gap-1">
                        <Zap size={10} fill="currentColor" /> Mega
                      </div>
                    )}
                  </div>
                  
                  <div className="p-6 space-y-4">
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <h3 className="text-2xl font-black uppercase tracking-tighter italic leading-none mb-1">{fakemon.name}</h3>
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
                    </div>
                  </div>
                </motion.div>
              ))}
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
