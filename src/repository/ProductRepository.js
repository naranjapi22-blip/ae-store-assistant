export class ProductRepository {
  async findByBarcode(_barcode) { throw new Error('Not implemented'); }
  async findByQuery(_query) { throw new Error('Not implemented'); }
  async findByReference(_reference) { throw new Error('Not implemented'); }
  async findByStyle(_style) { throw new Error('Not implemented'); }
  async searchProducts(_text, _limit = 20) { throw new Error('Not implemented'); }
  async getDepartments() { throw new Error('Not implemented'); }
  async getSections(_department) { throw new Error('Not implemented'); }
  async getFamilies(_department, _section) { throw new Error('Not implemented'); }
  async getProductsByCategory(_department, _section, _family, _limit = 20) { throw new Error('Not implemented'); }
  async findSimilarProducts(_options) { throw new Error('Not implemented'); }
  async findApplicablePromotions(_productContext) { return []; }
}
