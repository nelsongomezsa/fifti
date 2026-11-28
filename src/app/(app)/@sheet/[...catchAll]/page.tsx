/**
 * Cierra la hoja al navegar a cualquier otra ruta. Sin esto el router conserva la última hoja abierta aunque no se vea
 * en la URL, y al refrescar vuelve a pedir su pantalla (tras borrar, la de algo que ya no existe: 404).
 */
export default function NoSheet() {
  return null;
}
