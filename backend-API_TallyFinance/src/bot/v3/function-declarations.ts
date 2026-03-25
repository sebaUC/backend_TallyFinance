/**
 * Function declarations for Gemini function calling.
 * These define what the bot CAN do — Gemini picks which to call.
 */
import type { Tool } from '@google/generative-ai';

// Helper to avoid typing 'as any' everywhere (Gemini SDK typing is strict)
const S = (type: string, description: string, extra?: Record<string, any>) =>
  ({ type, description, ...extra } as any);

export const botTools: Tool[] = [
  {
    functionDeclarations: [
      {
        name: 'register_expense',
        description: 'Registra un gasto del usuario. Solo llamar si el usuario menciona un MONTO EXPLÍCITO.',
        parameters: {
          type: 'object' as any,
          properties: {
            amount: S('number', 'Monto en CLP (pesos chilenos). DEBE ser un número explícito del mensaje del usuario.'),
            category: S('string', 'Nombre de la categoría. Usar una de las categorías del usuario. Si no existe ninguna adecuada, enviar el nombre que dijo el usuario.'),
            name: S('string', 'Nombre descriptivo corto de la transacción (2-4 palabras, Title Case). Ej: "Almuerzo Trabajo", "Uber Aeropuerto", "Café Reunión"'),
            posted_at: S('string', 'Fecha ISO-8601 (YYYY-MM-DD). Default: fecha actual en Chile.'),
            description: S('string', 'Descripción adicional opcional'),
          },
          required: ['amount', 'category', 'name'],
        },
      },
      {
        name: 'register_income',
        description: 'Registra un ingreso del usuario (sueldo, venta, freelance, transferencia recibida). Los ingresos NO tienen categoría.',
        parameters: {
          type: 'object' as any,
          properties: {
            amount: S('number', 'Monto del ingreso en CLP'),
            source: S('string', 'Fuente del ingreso. Ej: "Sueldo Marzo", "Venta Bicicleta", "Freelance Diseño"'),
            posted_at: S('string', 'Fecha ISO-8601. Default: hoy'),
            recurring: S('boolean', 'true si es ingreso recurrente (sueldo mensual, arriendo, etc.)'),
            period: S('string', 'Periodicidad si es recurrente: "weekly" o "monthly"'),
          },
          required: ['amount', 'source'],
        },
      },
      {
        name: 'query_transactions',
        description: 'Busca, lista, suma o cuenta transacciones del usuario con filtros flexibles',
        parameters: {
          type: 'object' as any,
          properties: {
            operation: S('string', '"list" (ver transacciones), "sum" (total gastado/ingresado), "count" (cuántas)', { enum: ['list', 'sum', 'count'] }),
            type: S('string', '"expense" (solo gastos), "income" (solo ingresos), "all" (ambos)', { enum: ['expense', 'income', 'all'] }),
            category: S('string', 'Filtrar por nombre de categoría'),
            period: S('string', 'Período de tiempo', { enum: ['today', 'week', 'month', 'year', 'custom'] }),
            start_date: S('string', 'Fecha inicio ISO-8601 (solo para period=custom)'),
            end_date: S('string', 'Fecha fin ISO-8601 (solo para period=custom)'),
            limit: S('number', 'Máximo de resultados para list (default 10, max 50)'),
            search: S('string', 'Buscar por nombre o descripción de la transacción'),
          },
          required: ['operation'],
        },
      },
      {
        name: 'edit_transaction',
        description: 'Edita cualquier campo de una transacción existente. Puede cambiar monto, categoría, nombre, descripción o fecha.',
        parameters: {
          type: 'object' as any,
          properties: {
            transaction_id: S('string', 'UUID de la transacción (si se conoce del historial de conversación)'),
            hint_amount: S('number', 'Monto aproximado para identificar la transacción'),
            hint_category: S('string', 'Categoría para identificar la transacción'),
            hint_name: S('string', 'Nombre para identificar la transacción'),
            new_amount: S('number', 'Nuevo monto'),
            new_category: S('string', 'Nueva categoría'),
            new_name: S('string', 'Nuevo nombre'),
            new_description: S('string', 'Nueva descripción'),
            new_posted_at: S('string', 'Nueva fecha ISO-8601'),
          },
          required: [],
        },
      },
      {
        name: 'delete_transaction',
        description: 'Elimina una transacción',
        parameters: {
          type: 'object' as any,
          properties: {
            transaction_id: S('string', 'UUID de la transacción'),
            hint_amount: S('number', 'Monto para identificar la transacción'),
            hint_category: S('string', 'Categoría para identificar'),
            hint_name: S('string', 'Nombre para identificar'),
          },
          required: [],
        },
      },
      {
        name: 'manage_category',
        description: 'Gestiona las categorías del usuario: listar, crear, renombrar, eliminar, cambiar emoji o presupuesto',
        parameters: {
          type: 'object' as any,
          properties: {
            operation: S('string', 'Operación a realizar', { enum: ['list', 'create', 'rename', 'delete', 'update_icon', 'update_budget'] }),
            name: S('string', 'Nombre de la categoría'),
            new_name: S('string', 'Nuevo nombre (solo para rename)'),
            icon: S('string', 'Emoji para la categoría. Elegir el más representativo y creativo posible.'),
            budget: S('number', 'Presupuesto mensual en CLP'),
            force_delete: S('boolean', 'Forzar eliminación aunque tenga transacciones asociadas'),
          },
          required: ['operation'],
        },
      },
      {
        name: 'get_balance',
        description: 'Obtiene el balance financiero del usuario: saldo de cuenta, gastos, ingresos y presupuesto',
        parameters: {
          type: 'object' as any,
          properties: {
            period: S('string', 'Período', { enum: ['today', 'week', 'month', 'year', 'custom'] }),
            start_date: S('string', 'Fecha inicio (solo custom)'),
            end_date: S('string', 'Fecha fin (solo custom)'),
            category: S('string', 'Filtrar por categoría específica'),
            include_budget: S('boolean', 'Incluir estado del presupuesto activo'),
            include_breakdown: S('boolean', 'Incluir desglose por categoría'),
          },
          required: [],
        },
      },
      {
        name: 'get_app_info',
        description: 'Responde preguntas sobre TallyFinance, sus funcionalidades, limitaciones, seguridad, y cómo usar el bot',
        parameters: {
          type: 'object' as any,
          properties: {
            question: S('string', 'La pregunta del usuario sobre la app'),
          },
          required: ['question'],
        },
      },
    ],
  },
];
