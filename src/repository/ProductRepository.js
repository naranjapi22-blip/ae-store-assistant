export class ProductRepository {
  async findByBarcode(_barcode) { throw new Error('Not implemented'); }
  async searchProducts(_text, _limit = 20) { throw new Error('Not implemented'); }
}
