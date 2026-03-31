/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { GoogleGenAI, Type } from "@google/genai";
import { Sparkles, Loader2, Image as ImageIcon, Info, ChevronRight, Zap, Skull, Globe, Star } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence } from "motion/react";

// --- Types ---
interface FakemonStage {
  name: string;
  classification: string;
  typing: string;
  lore: string;
  imagePrompt: string;
  imageUrl?: string;
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

export default function App() {
  const [concept, setConcept] = useState("");
  const [category, setCategory] = useState("Comum");
  const [type1, setType1] = useState("Normal");
  const [type2, setType2] = useState("Nenhum");
  const [evolutions, setEvolutions] = useState(1);
  const [characteristic, setCharacteristic] = useState("none");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FakemonResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generateFakemon = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      
      // 1. Generate Text Content for all stages
      const isMega = characteristic === "mega";
      const totalStages = isMega ? evolutions + 1 : evolutions;

      const textPrompt = `
        Você é um Especialista em Game Design e Artista Conceitual da franquia Pokémon.
        Crie uma linha evolutiva de Pokémon (Fakemon) com base nestes parâmetros:
        - Conceito: ${concept || "Surpresa"}
        - Categoria: ${category}
        - Tipagem: ${type1}${type2 !== "Nenhum" ? ` / ${type2}` : ""}
        - Quantidade de estágios base: ${evolutions}
        - Mega Evolução inclusa: ${isMega ? "Sim" : "Não"}
        - Característica Especial: ${characteristic}

        Você deve gerar exatamente ${totalStages} Pokémon na linha evolutiva.
        ${isMega ? `O ÚLTIMO estágio (estágio ${totalStages}) DEVE ser a Mega Evolução do estágio anterior. O nome deve ser "Mega [Nome do Pokémon]".` : ""}
        
        Siga rigorosamente este formato JSON:
        {
          "evolutionLine": "Descrição geral da linha evolutiva",
          "stages": [
            {
              "name": "Nome do Pokémon",
              "classification": "Categoria",
              "typing": "Tipos",
              "lore": "Descrição detalhada (2-3 parágrafos) sobre comportamento, habitat e biologia.",
              "imagePrompt": "Prompt técnico e detalhado para gerador de imagem (estilo Ken Sugimori, fundo branco, detalhes nítidos, iluminação 3D moderna).",
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

      const textResponse = await ai.models.generateContent({
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
                  required: ["name", "classification", "typing", "lore", "imagePrompt", "stats"],
                }
              }
            },
            required: ["evolutionLine", "stages"],
          },
        },
      });

      const fakemonData = JSON.parse(textResponse.text || "{}") as FakemonResult;

      // 2. Generate Images for each stage
      const stagesWithImages = await Promise.all(fakemonData.stages.map(async (stage) => {
        const imageResponse = await ai.models.generateContent({
          model: "gemini-2.5-flash-image",
          contents: [{ parts: [{ text: stage.imagePrompt }] }],
          config: {
            imageConfig: {
              aspectRatio: "1:1",
            },
          },
        });

        let imageUrl = "";
        for (const part of imageResponse.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
            imageUrl = `data:image/png;base64,${part.inlineData.data}`;
            break;
          }
        }
        return { ...stage, imageUrl };
      }));

      setResult({ ...fakemonData, stages: stagesWithImages });
    } catch (err) {
      console.error(err);
      setError("Ocorreu um erro ao forjar seu Pokémon. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const StatBar = ({ label, value, color = "#00FF00" }: { label: string, value: number, color?: string }) => {
    const percentage = Math.min((value / 255) * 100, 100);
    return (
      <div className="space-y-1">
        <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-white">
          <span className="opacity-70">{label}</span>
          <span style={{ color: color }}>{value}</span>
        </div>
        <div className="h-2 bg-white/10 border border-white/20 overflow-hidden rounded-full">
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            transition={{ duration: 1.5, ease: "circOut" }}
            className="h-full rounded-full shadow-[0_0_8px_rgba(255,255,255,0.3)]"
            style={{ backgroundColor: color }}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#000000] font-sans selection:bg-[#00FF00] selection:text-[#000000]">
      {/* Header */}
      <header className="border-b-2 border-black p-6 md:p-8 flex justify-between items-center bg-[#FFFFFF]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-black rounded-full flex items-center justify-center">
            <Zap className="text-[#00FF00] w-6 h-6" />
          </div>
          <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tighter italic">
            PokéForge <span className="text-[#00FF00] stroke-black stroke-1">v1.0</span>
          </h1>
        </div>
        <div className="hidden md:block text-xs font-mono uppercase tracking-widest opacity-50">
          Advanced Fakemon Generation System // [2026]
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-2 min-h-[calc(100vh-100px)]">
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
                  {result.stages.map((stage, index) => (
                    <div key={index} className="space-y-8">
                      <div className="flex items-center gap-4">
                        <div className="bg-black text-[#00FF00] w-8 h-8 flex items-center justify-center font-black text-sm">
                          0{index + 1}
                        </div>
                        <div className="h-[2px] flex-1 bg-black/10" />
                      </div>

                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
                        {/* Image & Stats Display */}
                        <div className="relative group">
                          {/* The "Black Part" - Now containing Stats */}
                          <div className="absolute inset-0 bg-black translate-x-2 translate-y-2 group-hover:translate-x-3 group-hover:translate-y-3 transition-transform flex flex-col justify-end p-4">
                            <div className="grid grid-cols-2 gap-x-6 gap-y-3 pt-4 border-t border-white/20">
                              <StatBar label="HP" value={stage.stats.hp} color="#FF0000" />
                              <StatBar label="ATK" value={stage.stats.attack} color="#FFA500" />
                              <StatBar label="DEF" value={stage.stats.defense} color="#FFFF00" />
                              <StatBar label="S.ATK" value={stage.stats.spAtk} color="#0000FF" />
                              <StatBar label="S.DEF" value={stage.stats.spDef} color="#00FF00" />
                              <StatBar label="SPD" value={stage.stats.speed} color="#FF00FF" />
                            </div>
                          </div>

                          <div className="relative aspect-square bg-white border-4 border-black overflow-hidden mb-20 md:mb-24">
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
                          </div>
                          <div className="absolute top-4 right-4 bg-black text-[#00FF00] px-3 py-1 text-[10px] font-black uppercase tracking-widest border-2 border-[#00FF00]">
                            {characteristic === "mega" && index === result.stages.length - 1 ? "Mega Evolução" : `Estágio ${index + 1}`}
                          </div>
                        </div>

                        {/* Info Display */}
                        <div className="space-y-6">
                          <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-black pb-4">
                            <div className="space-y-1">
                              <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-50">#{Math.floor(Math.random() * 900) + 1000 + index}</p>
                              <h3 className="text-4xl md:text-5xl font-black uppercase tracking-tighter italic leading-none">{stage.name}</h3>
                            </div>
                            <div className="flex gap-2">
                              {stage.typing.split('/').map(t => (
                                <span key={t} className="bg-black text-white px-3 py-1 text-[10px] font-black uppercase border-2 border-black">
                                  {t.trim()}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div className="space-y-4">
                            <div className="space-y-1">
                              <label className="text-[10px] font-black uppercase tracking-widest opacity-50">Classificação</label>
                              <p className="font-bold text-base">{stage.classification}</p>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-black uppercase tracking-widest opacity-50">Lore (Pokédex)</label>
                              <div className="text-sm leading-relaxed prose prose-sm max-w-none prose-p:mb-4 prose-headings:font-black prose-headings:uppercase prose-headings:tracking-tighter">
                                <ReactMarkdown>{stage.lore}</ReactMarkdown>
                              </div>
                            </div>
                          </div>

                          <div className="pt-4 border-t border-black/10">
                            <label className="text-[10px] font-black uppercase tracking-widest opacity-30 mb-2 block">Prompt de Geração</label>
                            <p className="text-[10px] font-mono opacity-40 italic leading-tight">{stage.imagePrompt}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
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
