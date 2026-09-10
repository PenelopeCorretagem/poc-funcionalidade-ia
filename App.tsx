import React, { useEffect, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  StyleSheet,
} from 'react-native';
import { GoogleGenAI } from '@google/genai';
import Voice, {
  SpeechErrorEvent,
  SpeechResultsEvent,
} from '@react-native-voice/voice';

const GEMINI_API_KEY = '';

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// ---------- Tipos ----------

type TipoImovel = 'apartamento' | 'casa';

interface Imovel {
  id: number;
  tipo: TipoImovel;
  quartos: number;
  preco: number;
  bairro: string;
}

interface ImovelComPontuacao extends Imovel {
  pontuacao: number;
}

interface Filtros {
  tipo: TipoImovel | null;
  quartos: number | null;
  preco_max: number | null;
  bairro: string | null;
}

// Base de imóveis mockada (no projeto real isso viria do MySQL via Java)
const IMOVEIS: Imovel[] = [
  { id: 1, tipo: 'apartamento', quartos: 2, preco: 280000, bairro: 'Centro' },
  { id: 2, tipo: 'apartamento', quartos: 3, preco: 450000, bairro: 'Centro' },
  { id: 3, tipo: 'casa', quartos: 3, preco: 320000, bairro: 'Zona Sul' },
  { id: 4, tipo: 'apartamento', quartos: 1, preco: 190000, bairro: 'Zona Norte' },
  { id: 5, tipo: 'casa', quartos: 4, preco: 600000, bairro: 'Centro' },
  { id: 6, tipo: 'apartamento', quartos: 2, preco: 310000, bairro: 'Zona Sul' },
];

// Prompt que instrui a LLM a devolver SOMENTE um JSON com os filtros
function montarPrompt(textoUsuario: string): string {
  return `Você é um extrator de filtros de busca de imóveis.
Dada a frase do usuário, devolva SOMENTE um JSON (sem markdown, sem texto extra) com os campos abaixo, usando null quando não for possível identificar:

{
  "tipo": "apartamento" | "casa" | null,
  "quartos": number | null,
  "preco_max": number | null,
  "bairro": string | null
}

Frase do usuário: "${textoUsuario}"`;
}

// Extrai o JSON da resposta da LLM, removendo possíveis blocos de markdown
function extrairJson(textoResposta: string): Filtros {
  const limpo = textoResposta.replace(/```json|```/g, '').trim();
  return JSON.parse(limpo) as Filtros;
}

// Aplica os filtros extraídos e ordena por "proximidade" do pedido
function buscarImoveis(filtros: Filtros): ImovelComPontuacao[] {
  return IMOVEIS
    .map((imovel): ImovelComPontuacao => {
      let pontuacao = 0;
      if (filtros.tipo && imovel.tipo === filtros.tipo) pontuacao += 3;
      if (filtros.quartos && imovel.quartos === filtros.quartos) pontuacao += 3;
      if (
        filtros.bairro &&
        imovel.bairro.toLowerCase().includes(String(filtros.bairro).toLowerCase())
      ) {
        pontuacao += 2;
      }
      if (filtros.preco_max && imovel.preco <= filtros.preco_max) pontuacao += 2;
      return { ...imovel, pontuacao };
    })
    .filter((imovel) => imovel.pontuacao > 0)
    .sort((a, b) => b.pontuacao - a.pontuacao);
}

export default function App(): React.JSX.Element {
  const [textoUsuario, setTextoUsuario] = useState<string>('');
  const [carregando, setCarregando] = useState<boolean>(false);
  const [filtros, setFiltros] = useState<Filtros | null>(null);
  const [resultados, setResultados] = useState<ImovelComPontuacao[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState<boolean>(false);

  // Configura os listeners do reconhecimento de voz
  useEffect(() => {
    Voice.onSpeechResults = (e: SpeechResultsEvent) => {
      const texto = e.value?.[0];
      if (texto) {
        setTextoUsuario(texto);
      }
    };

    Voice.onSpeechError = (e: SpeechErrorEvent) => {
      setErro(e.error?.message ?? 'Erro no reconhecimento de voz.');
      setGravando(false);
    };

    Voice.onSpeechEnd = () => {
      setGravando(false);
    };

    return () => {
      // Remove os listeners e libera o reconhecedor ao desmontar o componente
      Voice.destroy().then(Voice.removeAllListeners);
    };
  }, []);

  async function iniciarGravacao(): Promise<void> {
    try {
      setErro(null);
      setTextoUsuario('');
      await Voice.start('pt-BR');
      setGravando(true);
    } catch (e) {
      setErro('Não foi possível acessar o microfone.');
      setGravando(false);
    }
  }

  async function pararGravacao(): Promise<void> {
    try {
      await Voice.stop();
    } catch (e) {
      // Se falhar ao parar, ainda assim tiramos o estado de "gravando"
    } finally {
      setGravando(false);
    }
  }

  async function handleBuscar(): Promise<void> {
    if (!textoUsuario.trim()) return;
    setCarregando(true);
    setErro(null);
    setFiltros(null);
    setResultados([]);

    try {
      const interaction = await ai.interactions.create({
        model: 'gemini-3.6-flash',
        input: montarPrompt(textoUsuario),
      });

      const textoResposta = interaction.output_text;

      if (!textoResposta) {
        throw new Error('Resposta vazia da LLM. Confira sua API key.');
      }

      const filtrosExtraidos = extrairJson(textoResposta);
      setFiltros(filtrosExtraidos);
      setResultados(buscarImoveis(filtrosExtraidos));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro desconhecido.');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.titulo}>Busca de imóveis por IA</Text>

      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, styles.inputComMic]}
          placeholder="Ex: quero um apê de 2 quartos até 300 mil no centro"
          value={textoUsuario}
          onChangeText={setTextoUsuario}
          multiline
        />

        <TouchableOpacity
          style={[styles.micBotao, gravando && styles.micBotaoAtivo]}
          onPress={gravando ? pararGravacao : iniciarGravacao}
          disabled={carregando}
        >
          <Text style={styles.micBotaoTexto}>{gravando ? '⏹' : '🎤'}</Text>
        </TouchableOpacity>
      </View>

      {gravando && <Text style={styles.gravandoTexto}>Ouvindo... fale agora</Text>}

      <TouchableOpacity style={styles.botao} onPress={handleBuscar} disabled={carregando}>
        <Text style={styles.botaoTexto}>{carregando ? 'Buscando...' : 'Buscar'}</Text>
      </TouchableOpacity>

      {carregando && <ActivityIndicator style={{ marginTop: 16 }} />}

      {erro && <Text style={styles.erro}>{erro}</Text>}

      {filtros && (
        <View style={styles.filtrosBox}>
          <Text style={styles.filtrosTitulo}>Filtros extraídos pela IA:</Text>
          <Text>{JSON.stringify(filtros, null, 2)}</Text>
        </View>
      )}

      <FlatList<ImovelComPontuacao>
        style={{ marginTop: 16 }}
        data={resultados}
        keyExtractor={(item) => String(item.id)}
        ListEmptyComponent={
          filtros && !carregando ? <Text>Nenhum imóvel compatível encontrado.</Text> : null
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitulo}>
              {item.tipo} • {item.quartos} quartos • {item.bairro}
            </Text>
            <Text>R$ {item.preco.toLocaleString('pt-BR')}</Text>
            <Text style={styles.cardScore}>compatibilidade: {item.pontuacao}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 60, backgroundColor: '#fff' },
  titulo: { fontSize: 22, fontWeight: 'bold', marginBottom: 16 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  inputComMic: {
    flex: 1,
    marginRight: 8,
  },
  micBotao: {
    width: 52,
    borderRadius: 8,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBotaoAtivo: {
    backgroundColor: '#dc2626',
  },
  micBotaoTexto: {
    fontSize: 22,
  },
  gravandoTexto: {
    color: '#dc2626',
    marginTop: 6,
    fontSize: 12,
  },
  botao: {
    backgroundColor: '#2563eb',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  botaoTexto: { color: '#fff', fontWeight: 'bold' },
  erro: { color: 'red', marginTop: 12 },
  filtrosBox: {
    marginTop: 16,
    backgroundColor: '#f3f4f6',
    padding: 12,
    borderRadius: 8,
  },
  filtrosTitulo: { fontWeight: 'bold', marginBottom: 4 },
  card: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  cardTitulo: { fontWeight: 'bold', marginBottom: 4, textTransform: 'capitalize' },
  cardScore: { color: '#6b7280', fontSize: 12, marginTop: 4 },
});